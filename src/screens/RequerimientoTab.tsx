// ── Requerimiento de compra ──────────────────────────────────────────────────
// Lista de productos (del inventario o NUEVOS) que se pasa al jefe para que
// APRUEBE o RECHACE la compra. Vive en el módulo COMPRAS (antes en Inventario).
// Si se aprueba con proveedor → genera orden + cuenta por pagar (trigger de BD
// `req_sync_compra`). Si se compra, se RECIBE en el inventario (genera entradas
// con el precio real). La recepción de stock sigue necesitando permiso de
// inventario. Solo los administradores aprueban/rechazan.
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Platform, Image, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { norm, onlyDecimal } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { rawCaseField } from '../lib/fonts';
import { InventoryRequirement, RequirementLine, InventoryLevel, Company, Supplier, RequirementStatus, Machinery, Employee, Cuenta } from '../types/database';
import { exportPdf, urlToDataUri } from '../lib/pdf';
import { pickAndUploadRequirementFile, captureAndUploadPhoto, pickAndUploadDocFile, pickAndUploadRequirementFiles, pickAndUploadDocFiles } from '../lib/photo';
import { FormatoAdjunto, empaquetarFormatosEnObservaciones, extraerFormatosAdjuntos, limpiarObservacionesFormatos } from '../lib/formatosAdjuntos';
import * as ImagePicker from 'expo-image-picker';
import { extraerCapturaPago, limpiarNotasUsuario, empaquetarNotasConCaptura, CapturaPagoInfo } from '../lib/proveedorPago';
import { requerimientoHtml, requerimientosBulkHtml, requerimientosResumenHtml, ReqPdfData } from '../lib/requerimiento';
import { CotizacionesModal } from '../components/CotizacionesModal';
import {
  CotizacionAlternativa,
  MonedaCotizacion,
  MONEDAS_COMUNES,
  empaquetarCotizacionesEnTexto,
  extraerCotizacionesDeTexto,
  formatearMoneda,
  simboloMoneda,
} from '../lib/cotizaciones';
import {
  extraerFactura,
  inyectarFacturaEnObservaciones,
  extraerReciboPago,
  inyectarReciboPagoEnObservaciones,
  extraerDespacho,
  inyectarDespachoEnObservaciones,
  extraerProveedorSugerido,
  expedienteCompletoHtml,
  type FacturaData,
  type ReciboPagoData,
  type DespachoAlmacenData,
  type EmpresaFactura,
} from '../lib/requerimientoExpediente';
import { machineLabel, machineMatches } from '../lib/machineLabel';
// 👤 Quién solicitó / quién autorizó, para qué (vehículo o maquinaria), a qué
//    área, y las observaciones del final (20-oct-2026, a pedido).
import { PersonaNominaPicker } from '../components/PersonaNominaPicker';
import {
  areasSugeridas, camposRequerimiento, contactoDesdeNombre, destinoLabel, personasDeNomina,
  DESTINOS, SIN_PERSONA, faltaColumnaNueva,
  type PersonaElegida, type PersonaNomina,
} from '../lib/requerimientoPersonas';
import { useBcvRate, bsFromUsd, usdFromBs, fmtBs } from '../lib/bcv';
import {
  calcularEstadoRequerimiento,
  calcularTotalReqUsd,
  LIMITE_MONTO_GERENTE_GENERAL_USD,
  obtenerProveedorDeLinea,
  obtenerConfigAprobacionMonto,
  guardarConfigAprobacionMonto,
  type InfoEstadoRequerimiento,
  type ReglaAprobacionMonto,
} from '../lib/requerimientoFlujo';
import {
  inyectarReciboPagoEnNota,
  CONDICIONES_PAGO_CHIPS,
  toggleChipCondicionPago,
  extraerCondicionesPago,
  limpiarCondicionesPagoDeNota,
  inyectarCondicionesPagoEnNota,
} from '../lib/cuentasPago';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
// ⚠️ 19-sep-2026: antes botaba la coma («12,50» se guardaba como 1250). Ahora punto
//    y coma valen igual; la regla vive en src/lib/numeros.ts.
const parseNum = leerNumero;
const nowISO = () => new Date().toISOString();

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

export interface PresupuestoItem {
  id: string;
  proveedor: string;
  concepto?: string;
  metodo_pago?: string;
  modo_precio?: 'unidad' | 'total';
  precio_usd: string;       // Precio unitario c/u en $ USD
  precio_bs: string;        // Precio unitario c/u en Bs
  total_usd?: string;       // Precio total por la cantidad del ítem en $ USD
  total_bs?: string;        // Precio total por la cantidad del ítem en Bs
  archivos?: FormatoAdjunto[]; // Uno o varios archivos/fotos de presupuesto adjuntos
  nota?: string;
}

export const METODOS_PAGO_COTIZACION = [
  { key: 'efectivo_usd', label: 'Efectivo USD', icon: '💵' },
  { key: 'pago_movil', label: 'Pago Móvil / Transf. Bs', icon: '📱' },
  { key: 'zelle', label: 'Zelle', icon: '⚡' },
  { key: 'transferencia_usd', label: 'Banesco Panamá / Transf. $', icon: '🏦' },
  { key: 'debito', label: 'Punto / Débito', icon: '💳' },
  { key: 'binance', label: 'Binance USDT', icon: '🟡' },
  { key: 'credito', label: 'Crédito', icon: '⏳' },
  { key: 'otro', label: 'Otro', icon: '✏️' },
];

type ReqRow = {
  key: string;
  product_id: string | null;
  name: string;
  unit: string;
  qty: string;
  modo_precio?: 'unidad' | 'total'; // 🎯 Por Unidad (c/u) o 📦 Precio Total por la cantidad
  price: string;       // Precio unitario en $ USD
  price_bs: string;    // Precio unitario en Bs (independiente para edición manual)
  total_usd?: string;  // Precio total en $ USD (cuando se coloca el total por los objetos)
  total_bs?: string;   // Precio total en Bs (cuando se coloca el total por los objetos)
  currency: 'USD' | 'VES';
  note: string;
  image_url: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  metodo_pago?: string | null;
  exento?: boolean;    // 🧾 Cuadrito Exento de IVA
  presupuestos?: PresupuestoItem[]; // 📋 Cotizaciones / Presupuestos alternos (uno o varios)
  presupuestosAbierto?: boolean;
};
const REQ_STATUS: Record<string, { label: string; color: string; short: string }> = {
  pendiente: { label: '⏳ Pendiente', color: '#D97706', short: 'Pendiente' },
  aprobado: { label: '✅ Aprobado', color: '#2563EB', short: 'Aprobado' },
  esperando_recepcion: { label: '📦 Esperando Recepción', color: '#0D9488', short: 'Esperando Recepción' },
  pagado: { label: '📦 Esperando Recepción', color: '#0D9488', short: 'Esperando Recepción' },
  rechazado: { label: '❌ Rechazado', color: '#DC2626', short: 'Rechazado' },
  recibido: { label: '📦 Recibido', color: '#16A34A', short: 'Recibido' },
  aclaratoria_solicitada: { label: '⚠️ Aclaratoria Técnica Solicitada', color: '#EA580C', short: 'En Aclaratoria' },
};
function nextReqCode(codes: (string | null | undefined)[], bump = 0): string {
  let max = 0;
  codes.forEach((c) => { const m = String(c ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'REQ-' + String(max + 1 + bump).padStart(4, '0');
}
const dmyOf = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

function ItemSupplierPicker({
  supplierId,
  supplierName,
  suppliers,
  onSelect,
}: {
  supplierId: string | null | undefined;
  supplierName?: string | null | undefined;
  suppliers: Supplier[];
  onSelect: (id: string | null, name: string | null) => void;
}) {
  const { colors } = useTheme();
  const [activo, setActivo] = useState(Boolean(supplierId));
  const [search, setSearch] = useState('');
  const [abierto, setAbierto] = useState(!supplierId);

  useEffect(() => {
    if (supplierId) {
      setActivo(true);
    }
  }, [supplierId]);

  const toggleCheck = () => {
    if (activo) {
      setActivo(false);
      setSearch('');
      setAbierto(false);
      onSelect(null, null);
    } else {
      setActivo(true);
      setAbierto(true);
    }
  };

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const currentName = selectedSupplier?.name || supplierName;

  const filteredSuppliers = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = norm(search);
    return suppliers.filter((s) => norm(s.name).includes(q) || (s.rif && norm(s.rif).includes(q)));
  }, [suppliers, search]);

  return (
    <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      {/* Checkbox para activar proveedor individual */}
      <TouchableOpacity
        onPress={toggleCheck}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: activo ? colors.brand : colors.border,
            backgroundColor: activo ? colors.brand : colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {activo ? <Text style={{ color: colors.brandContrast, fontSize: 13, fontWeight: '900', lineHeight: 14 }}>✓</Text> : null}
        </View>
        <Text style={{ color: activo ? colors.text : colors.muted, fontSize: 12, fontWeight: activo ? '700' : '600' }}>
          Asignar proveedor específico a este ítem (compra consolidada)
        </Text>
      </TouchableOpacity>

      {/* Panel de opciones y buscador (solo si el check está activo) */}
      {activo ? (
        <View
          style={{
            marginTop: 6,
            padding: 8,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {supplierId && currentName ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: colors.surface,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: colors.brand,
                marginBottom: abierto ? 8 : 0,
              }}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>
                  🏢 Proveedor Asignado
                </Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
                  {currentName}
                </Text>
                {selectedSupplier?.rif ? (
                  <Text style={{ color: colors.muted, fontSize: 10 }}>RIF: {selectedSupplier.rif}</Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => setAbierto((v) => !v)}
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>
                    {abierto ? '▲ Cerrar' : '🔍 Cambiar'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    onSelect(null, null);
                    setAbierto(true);
                  }}
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Desplegable vertical con buscador */}
          {abierto || !supplierId ? (
            <View>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="🔍 Buscar proveedor por nombre o RIF…"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.sm,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  color: colors.text,
                  fontSize: 12,
                  marginBottom: 6,
                }}
              />
              <View style={{ maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 180 }}>
                  {filteredSuppliers.map((s) => {
                    const sel = s.id === supplierId;
                    return (
                      <TouchableOpacity
                        key={s.id}
                        onPress={() => {
                          onSelect(s.id, s.name);
                          setAbierto(false);
                          setSearch('');
                        }}
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                          backgroundColor: sel ? colors.brand : 'transparent',
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1, marginRight: 6 }}>
                          <Text style={{ color: sel ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: sel ? '800' : '600' }} numberOfLines={1}>
                            {s.name}
                          </Text>
                          {s.rif ? (
                            <Text style={{ color: sel ? colors.brandContrast : colors.muted, fontSize: 10 }}>
                              {s.rif}
                            </Text>
                          ) : null}
                        </View>
                        {sel ? (
                          <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredSuppliers.length === 0 ? (
                    <View style={{ padding: 12, alignItems: 'center' }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Sin coincidencias para «{search}»</Text>
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

export function RequerimientoTab({ canWrite }: { canWrite: boolean }) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const { session, role, moduleLevel } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const isAdmin = role === 'admin';
  // Full control de Inventario (no solo admin) también puede marcar "Recibido" —
  // pedido directo del cliente (04/08/2026): que el permiso "todos los permisos de
  // inventario" alcance para cambiar ese estado, sin depender del rol.
  const canReceive = isAdmin || levelMeets(moduleLevel('inventario'), 'full');
  const uid = session?.user?.id ?? null;
  const { rate } = useBcvRate();
  const { data: reqs, loading, refetch } = useTable<InventoryRequirement>('inventory_requirements', { orderBy: 'created_at', ascending: false });
  // Filtro por estatus del requerimiento (+ "sin precio" para ubicar los que faltan cargar precio).
  const [filterStatus, setFilterStatus] = useState<'todos' | 'pendiente' | 'aprobado' | 'esperando_recepcion' | 'rechazado' | 'recibido' | 'sin_precio' | 'aclaratoria_solicitada'>('todos');
  const faltaPrecioDe = (r: InventoryRequirement) => r.items.some((it) => !(Number(it.est_price) > 0));
  // Búsqueda libre (código, título, nota, solicitante, empresa, nombre de los ítems) +
  // rango de fecha (por created_at, ISO AAAA-MM-DD) — se combinan con el filtro de estatus.
  const [listQuery, setListQuery] = useState('');
  const [reqDateFrom, setReqDateFrom] = useState('');
  const [reqDateTo, setReqDateTo] = useState('');
  // Selección manual (checkbox) para descargar en UN SOLO PDF a los elegidos; si no hay
  // ninguno seleccionado, el PDF por lote toma a TODOS los que quedaron filtrados.
  const [reqSelIds, setReqSelIds] = useState<Set<string>>(new Set());
  const toggleReqSel = (id: string) => setReqSelIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const { data: levels } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name', ascending: true });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? null : null);
  // Proveedores del catálogo (para asignar al requerimiento — opcional).
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  // Cuentas por pagar sincronizadas (para detectar pagos realizados en Tesorería)
  const { data: cuentasData, refetch: refetchCuentas } = useTable<Cuenta>('cuentas');
  const cuentasPagadasSet = useMemo(() => {
    const set = new Set<string>();
    (cuentasData || []).forEach((c) => {
      if ((c.estado === 'pagada' || (c as any).saldo <= 0) && c.order_id) {
        set.add(c.order_id);
      }
    });
    return set;
  }, [cuentasData]);

  // Crear / editar requerimiento (editId != null → estamos editando ese requerimiento)
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null); // empresa del requerimiento
  const [supplierId, setSupplierId] = useState<string | null>(null); // proveedor (opcional) → orden + cuenta por pagar
  // 🏢 Empresa Pagadora (Fase previa a Tesorería)
  const [empresaPagadoraId, setEmpresaPagadoraId] = useState<string | null>(null);
  const [empresaPagadoraNombre, setEmpresaPagadoraNombre] = useState<string | null>(null);

  // 🚜 Catálogo de maquinaria y personal para selectores con buscador y placa
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'name' });

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

  // 💳 Recibo / Comprobante de Pago (sincronizado con Cuentas por Pagar)
  const [reciboPagoUrl, setReciboPagoUrl] = useState<string | null>(null);
  const [reciboPagoTipo, setReciboPagoTipo] = useState<'image' | 'pdf' | null>('image');
  const [reciboPagoNombre, setReciboPagoNombre] = useState<string | null>(null);
  const [reciboPagoRef, setReciboPagoRef] = useState('');
  const [reciboPagoFecha, setReciboPagoFecha] = useState('');
  const [reciboPagoMetodo, setReciboPagoMetodo] = useState('');
  const [subiendoReciboPago, setSubiendoReciboPago] = useState(false);

  // ⚙️ Regla de Aprobación por Monto, Empresa y Personas
  const [configAprobacion, setConfigAprobacion] = useState<ReglaAprobacionMonto>(obtenerConfigAprobacionMonto);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [cfgMonto, setCfgMonto] = useState('1000');
  const [cfgEmpresaId, setCfgEmpresaId] = useState<string | null>(null);
  const [cfgEmpresaNombre, setCfgEmpresaNombre] = useState('Todas las empresas');
  const [cfgAprobadoresNombres, setCfgAprobadoresNombres] = useState<string[]>([]);

  // 👁️ Visor de Factura / Recibo Modal
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

  // 💳 Modal de edición rápida de datos de pago del proveedor en tiempo real
  const [modalPagoProvOpen, setModalPagoProvOpen] = useState(false);
  const [provParaPago, setProvParaPago] = useState<Supplier | null>(null);
  const [provBanco, setProvBanco] = useState('');
  const [provNumCuenta, setProvNumCuenta] = useState('');
  const [provTipoCuenta, setProvTipoCuenta] = useState('Corriente');
  const [provTitular, setProvTitular] = useState('');
  const [provDocTitular, setProvDocTitular] = useState('');
  const [provPagoMovilTel, setProvPagoMovilTel] = useState('');
  const [provPagoMovilDoc, setProvPagoMovilDoc] = useState('');
  const [provPagoMovilBanco, setProvPagoMovilBanco] = useState('');
  const [provBinanceId, setProvBinanceId] = useState('');
  const [provNotasPago, setProvNotasPago] = useState('');
  const [provPaymentPhotoUrl, setProvPaymentPhotoUrl] = useState('');
  const [provPaymentPhotoName, setProvPaymentPhotoName] = useState('');
  const [subiendoCapturaProv, setSubiendoCapturaProv] = useState(false);
  const [visorCapturaProv, setVisorCapturaProv] = useState<CapturaPagoInfo | null>(null);
  const [guardandoPagoProv, setGuardandoPagoProv] = useState(false);

  // 🔄 Ciclo de Retroalimentación Técnica (Bucle de Cotización)
  const [aclaratoriaOpen, setAclaratoriaOpen] = useState(false);
  const [aclaratoriaTarget, setAclaratoriaTarget] = useState<InventoryRequirement | null>(null);
  const [aclaratoriaMotivo, setAclaratoriaMotivo] = useState('');
  const [aclaratoriaBusy, setAclaratoriaBusy] = useState(false);

  // 📝 Responder Aclaratoria Técnica (Solicitante)
  const [respuestaOpen, setRespuestaOpen] = useState(false);
  const [respuestaTarget, setRespuestaTarget] = useState<InventoryRequirement | null>(null);
  const [respuestaTexto, setRespuestaTexto] = useState('');
  const [respuestaBusy, setRespuestaBusy] = useState(false);

  const [rows, setRows] = useState<ReqRow[]>([]);
  const [alicuotaIva, setAlicuotaIva] = useState('16');
  const [q, setQ] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [supQ, setSupQ] = useState('');       // búsqueda de proveedor
  const [supOpen, setSupOpen] = useState(false); // desplegable de proveedor abierto
  // 👤 RESPONSABLE (17-oct-2026, a pedido): quien lo CREA sale solo (requested_by_name);
  // el RESPONSABLE se elige entre los usuarios del rol ALMACENISTA y al elegido le llega
  // un aviso a su campana. ES OPCIONAL pero el rótulo no lo dice (pedido textual: «el
  // encargado es opcional, colócalo sin que diga opcional»).
  const [respId, setRespId] = useState<string | null>(null);
  const [respNombre, setRespNombre] = useState<string | null>(null);
  const [almacenistas, setAlmacenistas] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      try {
        // Mismo criterio que Compras usa para reconocer al almacenista: el NOMBRE del
        // rol dinámico contiene «almacen» (esAlmacenista en ComprasScreen).
        const { data } = await supabase.from('profiles').select('id, full_name, app_role:app_role_id(name)');
        setAlmacenistas(((data ?? []) as any[])
          .filter((p) => /almacen/i.test(String(p.app_role?.name ?? '')) && String(p.full_name ?? '').trim())
          .map((p) => ({ id: String(p.id), name: String(p.full_name).trim() }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')));
      } catch { setAlmacenistas([]); }
    })();
  }, [createOpen]);

  // 👤 SOLICITÓ / AUTORIZÓ / PARA QUÉ / ÁREA / OBSERVACIONES (20-oct-2026, a pedido).
  // La nómina SOLO SE LEE (ni un insert ni un update sobre `employees`): la ficha
  // elegida se copia al requerimiento. Lo único que llega a escribirse es un
  // CONTACTO, y solo si el usuario escribe un nombre que no está en ninguna lista.
  const [solicitante, setSolicitante] = useState<PersonaElegida>(SIN_PERSONA);
  const [autorizado, setAutorizado] = useState<PersonaElegida>(SIN_PERSONA);
  const [destino, setDestino] = useState<string | null>(null);
  const [area, setArea] = useState<string>('');
  const [areaLibre, setAreaLibre] = useState(false);     // escribir un área que no está en la lista
  const [condicionesPago, setCondicionesPago] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [personas, setPersonas] = useState<PersonaNomina[]>([]);
  const [contactosLista, setContactosLista] = useState<{ id: string; name: string }[]>([]);
  const [cargandoNomina, setCargandoNomina] = useState(false);
  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      setCargandoNomina(true);
      // Si alguna lectura falla, se sigue con la lista vacía: el nombre siempre se
      // puede escribir a mano, así que el formulario nunca se queda trancado.
      // Ojo: el builder de supabase-js es un `PromiseLike`, no una `Promise` — no
      // tiene `.catch`. El segundo callback de `then` es el que atrapa el fallo.
      const [emp, cont] = await Promise.all([
        supabase.from('employees').select('id, first_name, last_name, cedula, cargo, department, status')
          .then((r) => r.data ?? [], () => [] as any[]),
        supabase.from('contactos').select('id, name').then((r) => r.data ?? [], () => [] as any[]),
      ]);
      setPersonas(personasDeNomina(emp as any[]));
      setContactosLista((cont as any[]).map((c) => ({ id: String(c.id), name: String(c.name ?? '') })));
      setCargandoNomina(false);
    })();
  }, [createOpen]);
  // Las áreas que se ofrecen: las de la nómina + las ya usadas en requerimientos.
  // No hay catálogo nuevo que mantener (dos listas se desincronizan en una semana).
  const areas = React.useMemo(
    () => areasSugeridas(personas.map((p) => p.area), (reqs ?? []).map((r) => r.area)),
    [personas, reqs],
  );
  /**
   * Guarda en CONTACTOS un nombre escrito a mano. Devuelve el aviso si NO quedó.
   * El `.select('id')` es obligatorio: la RLS de `contactos` pide permiso de
   * compras/ventas/contactos, y a quien solo tiene inventario le rechaza la fila
   * SIN error y con 0 filas — el clásico borrado que finge éxito, al revés.
   */
  const guardarContacto = async (nombre: string): Promise<string | null> => {
    const fila = contactoDesdeNombre(nombre);
    if (!fila) return null;
    const { data, error } = await supabase.from('contactos')
      .insert({ ...fila, created_by: uid ?? null }).select('id');
    if (error) {
      return /duplicate|unique/i.test(error.message)
        ? null // ya estaba: el nombre igual queda en el requerimiento
        : `El nombre quedó en el requerimiento, pero no se pudo agregar a Contactos: ${error.message}`;
    }
    if (!data || data.length === 0) {
      return 'El nombre quedó en el requerimiento, pero no se agregó a Contactos (no tienes permiso de Compras ni de Contactos).';
    }
    setContactosLista((p) => [...p, { id: String(data[0].id), name: nombre }]);
    return null;
  };
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);                    // error visible DENTRO del Modal (el toast queda tapado)
  const [subiendoId, setSubiendoId] = useState<string | null>(null);              // formato subiendo
  const [previewReq, setPreviewReq] = useState<InventoryRequirement | null>(null); // vista previa del formato
  const [previewIndex, setPreviewIndex] = useState(0);                            // índice del formato activo en la vista previa
  // Formatos (imágenes/PDFs) adjuntados AL CREAR/EDITAR el requerimiento (dos o más archivos).
  const [formatos, setFormatos] = useState<FormatoAdjunto[]>([]);
  const [subiendoNuevo, setSubiendoNuevo] = useState(false);
  const [subiendoImgKey, setSubiendoImgKey] = useState<string | null>(null); // imagen de producto subiéndose

  // Recibir en inventario
  const [recvFor, setRecvFor] = useState<InventoryRequirement | null>(null);
  const [recvRows, setRecvRows] = useState<{ product_id: string | null; name: string; unit: string | null; qty: string; price: string; currency: string; note?: string }[]>([]);
  const [recvBusy, setRecvBusy] = useState(false);
  // 🧾 Factura y Nota al recibir en Almacén (sincronizada con Cuentas por Pagar)
  const [recvFacturaNumero, setRecvFacturaNumero] = useState('');
  const [recvFacturaUrl, setRecvFacturaUrl] = useState<string | null>(null);
  const [recvFacturaTipo, setRecvFacturaTipo] = useState<'image' | 'pdf' | null>(null);
  const [recvFacturaNombre, setRecvFacturaNombre] = useState<string | null>(null);
  const [recvSubiendoFactura, setRecvSubiendoFactura] = useState(false);
  const [recvNota, setRecvNota] = useState('');

  // 📋 Modal de Cotizaciones Múltiples y Multi-Moneda
  const [cotizacionesTarget, setCotizacionesTarget] = useState<InventoryRequirement | null>(null);
  const [cotizacionesModalOpen, setCotizacionesModalOpen] = useState(false);

  const getReqCotizaciones = (r: InventoryRequirement): CotizacionAlternativa[] => {
    if (Array.isArray(r.cotizaciones) && r.cotizaciones.length > 0) return r.cotizaciones;
    return extraerCotizacionesDeTexto(r.observaciones);
  };

  const abrirCotizaciones = (r: InventoryRequirement) => {
    setCotizacionesTarget(r);
    setCotizacionesModalOpen(true);
  };

  const guardarCotizacionesReq = async (nuevas: CotizacionAlternativa[], ganadora?: CotizacionAlternativa | null) => {
    if (!cotizacionesTarget) return;
    const patch: any = {
      cotizaciones: nuevas,
      observaciones: empaquetarCotizacionesEnTexto(cotizacionesTarget.observaciones, nuevas),
    };
    if (ganadora) {
      if (ganadora.supplier_id) patch.supplier_id = ganadora.supplier_id;
      const tasaGan = ganadora.exchange_rate || rate || 0;
      const toUsd = (monto: number) => {
        if (ganadora.currency === 'USD' || ganadora.currency === 'USDT') return monto;
        return tasaGan > 0 ? Math.round((monto / tasaGan) * 100) / 100 : monto;
      };
      const toBs = (monto: number) => {
        if (ganadora.currency === 'VES') return monto;
        return tasaGan > 0 ? Math.round(monto * tasaGan * 100) / 100 : 0;
      };

      if (cotizacionesTarget.items && cotizacionesTarget.items.length > 0) {
        if (Array.isArray(ganadora.presupuestos) && ganadora.presupuestos.length > 0) {
          patch.items = cotizacionesTarget.items.map((item, idx) => {
            const presLinea = ganadora.presupuestos!.find((p) => p.item_index === idx) ||
              (cotizacionesTarget.items.length === 1 ? ganadora.presupuestos![0] : null);
            if (!presLinea) return item;
            const cant = Math.max(0.0001, Number(item.qty) || Number(presLinea.qty) || 1);
            const unitMoneda = presLinea.modo_precio === 'unidad'
              ? Number(presLinea.precio_unitario ?? presLinea.unit_price) || 0
              : (Number(presLinea.precio_total ?? presLinea.total_price) || 0) / cant;
            const totMoneda = presLinea.modo_precio === 'total'
              ? Number(presLinea.precio_total ?? presLinea.total_price) || 0
              : unitMoneda * cant;
            const unitUsd = toUsd(unitMoneda);
            const totUsd = toUsd(totMoneda);
            const unitBs = toBs(unitMoneda);
            const totBs = toBs(totMoneda);
            return {
              ...item,
              modo_precio: presLinea.modo_precio || 'unidad',
              est_price: unitUsd,
              price_usd: unitUsd,
              price_bs: unitBs,
              total_usd: totUsd,
              total_bs: totBs,
              currency: 'USD',
              exchange_rate: ganadora.exchange_rate,
              supplier_id: ganadora.supplier_id || item.supplier_id,
              supplier_name: ganadora.supplier_name || item.supplier_name,
            };
          });
        } else if (cotizacionesTarget.items.length === 1) {
          const item0 = cotizacionesTarget.items[0];
          const cant = Math.max(0.0001, Number(item0.qty) || 1);
          const modoGan = ganadora.modo_precio || 'total';
          const totMoneda = Number(ganadora.price) || 0;
          const unitMoneda = modoGan === 'unidad' && ganadora.unit_price
            ? Number(ganadora.unit_price)
            : totMoneda / cant;
          const unitUsd = toUsd(unitMoneda);
          const totUsd = toUsd(totMoneda);
          const unitBs = toBs(unitMoneda);
          const totBs = toBs(totMoneda);
          patch.items = [{
            ...item0,
            modo_precio: modoGan,
            est_price: unitUsd,
            price_usd: unitUsd,
            price_bs: unitBs,
            total_usd: totUsd,
            total_bs: totBs,
            currency: 'USD',
            exchange_rate: ganadora.exchange_rate,
            supplier_id: ganadora.supplier_id || item0.supplier_id,
            supplier_name: ganadora.supplier_name || item0.supplier_name,
          }];
        }
      }
    }
    const { error } = await supabase.from('inventory_requirements').update(patch).eq('id', cotizacionesTarget.id);
    if (error) {
      const { error: err2 } = await supabase.from('inventory_requirements').update({
        observaciones: patch.observaciones,
        ...(patch.supplier_id ? { supplier_id: patch.supplier_id } : {}),
        ...(patch.items ? { items: patch.items } : {}),
      }).eq('id', cotizacionesTarget.id);
      if (err2) throw err2;
    }
    refetch();
  };

  const subirFacturaRecibir = async (origen: 'camara' | 'archivo') => {
    setRecvSubiendoFactura(true);
    try {
      if (origen === 'camara') {
        const r = await captureAndUploadPhoto('requerimientos');
        if (r.ok && r.url) {
          setRecvFacturaUrl(r.url);
          setRecvFacturaTipo('image');
          setRecvFacturaNombre('Foto Factura.jpg');
          toast.success('Foto de factura cargada.');
        } else if (r.error) {
          toast.error(r.error);
        }
      } else {
        const r = await pickAndUploadRequirementFile('requerimientos');
        if (r.ok && r.url) {
          setRecvFacturaUrl(r.url);
          setRecvFacturaTipo(r.kind === 'pdf' ? 'pdf' : 'image');
          setRecvFacturaNombre(r.name || 'Factura');
          toast.success('Archivo de factura cargado.');
        } else if (r.error) {
          toast.error(r.error);
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo subir la factura.');
    } finally {
      setRecvSubiendoFactura(false);
    }
  };

  const inp = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  let seq = 0;
  const newKey = () => `${Date.now()}-${seq++}-${rows.length}`;
  const fmtClean = (n: number) => (n > 0 ? (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '') : '0');

  const addBlank = () => setRows((r) => [...r, {
    key: newKey(),
    product_id: null,
    name: '',
    unit: '',
    qty: '1',
    modo_precio: 'unidad',
    price: '0',
    price_bs: '0',
    total_usd: '0',
    total_bs: '0',
    currency: 'USD',
    note: '',
    image_url: '',
    exento: false,
    presupuestos: [],
    presupuestosAbierto: false,
  }]);
  const addFromProduct = (it: InventoryLevel) => {
    const pUsd = Number(it.avg_cost) || 0;
    const pBs = rate && rate > 0 ? fmtClean(pUsd * rate) : '0';
    setRows((r) => [...r, {
      key: newKey(),
      product_id: it.id,
      name: it.name,
      unit: it.unit || '',
      qty: '1',
      modo_precio: 'unidad',
      price: String(pUsd),
      price_bs: pBs,
      total_usd: String(pUsd),
      total_bs: pBs,
      currency: 'USD',
      note: '',
      image_url: '',
      exento: false,
      presupuestos: [],
      presupuestosAbierto: false,
    }]);
    setPickOpen(false); setQ('');
  };
  const upd = (key: string, field: keyof ReqRow, val: any) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [field]: val } : x)));
  const rm = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  // Cambio de cantidad: recalcula total (si está en modo 'unidad') o unitario (si está en modo 'total')
  const handleQtyChange = (key: string, val: string) => {
    const clean = onlyDecimal(val);
    const q = Math.max(0.0001, parseNum(clean) || 1);
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const modo = x.modo_precio || 'unidad';
      const nextPresupuestos = (x.presupuestos || []).map((c) => {
        const mCot = c.modo_precio || 'unidad';
        if (mCot === 'total') {
          const tU = parseNum(c.total_usd || '0');
          const tB = parseNum(c.total_bs || '0');
          return {
            ...c,
            precio_usd: tU > 0 ? fmtClean(tU / q) : c.precio_usd,
            precio_bs: tB > 0 ? fmtClean(tB / q) : c.precio_bs,
          };
        } else {
          const uU = parseNum(c.precio_usd || '0');
          const uB = parseNum(c.precio_bs || '0');
          return {
            ...c,
            total_usd: uU > 0 ? fmtClean(uU * q) : c.total_usd,
            total_bs: uB > 0 ? fmtClean(uB * q) : c.total_bs,
          };
        }
      });
      if (modo === 'total') {
        const tUsd = parseNum(x.total_usd || '0');
        const tBs = parseNum(x.total_bs || '0');
        return {
          ...x,
          qty: clean,
          price: tUsd > 0 ? fmtClean(tUsd / q) : '0',
          price_bs: tBs > 0 ? fmtClean(tBs / q) : '0',
          presupuestos: nextPresupuestos,
        };
      } else {
        const uUsd = parseNum(x.price);
        const uBs = parseNum(x.price_bs);
        return {
          ...x,
          qty: clean,
          total_usd: uUsd > 0 ? fmtClean(uUsd * q) : '0',
          total_bs: uBs > 0 ? fmtClean(uBs * q) : '0',
          presupuestos: nextPresupuestos,
        };
      }
    }));
  };

  // Alternar entre 🎯 Precio por Unidad (c/u) y 📦 Precio Total (por todos los objetos del renglón)
  const cambiarModoPrecioRow = (key: string, nuevoModo: 'unidad' | 'total') => {
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const uUsd = parseNum(x.price);
      const uBs = parseNum(x.price_bs);
      const tUsd = parseNum(x.total_usd || '0') || (uUsd * q);
      const tBs = parseNum(x.total_bs || '0') || (uBs * q);
      return {
        ...x,
        modo_precio: nuevoModo,
        total_usd: tUsd > 0 ? fmtClean(tUsd) : x.price,
        total_bs: tBs > 0 ? fmtClean(tBs) : x.price_bs,
        price: tUsd > 0 ? fmtClean(tUsd / q) : x.price,
        price_bs: tBs > 0 ? fmtClean(tBs / q) : x.price_bs,
      };
    }));
  };

  // Manejo de precio en dólares ($ USD): respeta si el usuario está ingresando por unidad o el total
  const handlePrecioUsdChange = (key: string, val: string) => {
    const clean = onlyDecimal(val);
    const numUsd = parseNum(clean);
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const modo = x.modo_precio || 'unidad';
      if (modo === 'total') {
        const totBsActual = x.total_bs || '';
        const bsVacio = !totBsActual || totBsActual === '0' || totBsActual === '0.00';
        const nuevoTotBs = bsVacio && rate && rate > 0 && numUsd > 0
          ? fmtClean(numUsd * rate)
          : (clean === '' ? '' : totBsActual);
        const unitUsd = numUsd > 0 ? fmtClean(numUsd / q) : (clean === '' ? '' : '0');
        const numTotBs = parseNum(nuevoTotBs);
        const unitBs = numTotBs > 0 ? fmtClean(numTotBs / q) : (nuevoTotBs === '' ? '' : '0');
        return { ...x, total_usd: clean, total_bs: nuevoTotBs, price: unitUsd, price_bs: unitBs };
      } else {
        const bsVacio = !x.price_bs || x.price_bs === '' || x.price_bs === '0' || x.price_bs === '0.00';
        const nuevoBs = bsVacio && rate && rate > 0 && numUsd > 0
          ? fmtClean(numUsd * rate)
          : (clean === '' ? '' : x.price_bs);
        const totUsd = numUsd > 0 ? fmtClean(numUsd * q) : '0';
        const numBs = parseNum(nuevoBs);
        const totBs = numBs > 0 ? fmtClean(numBs * q) : '0';
        return { ...x, price: clean, price_bs: nuevoBs, total_usd: totUsd, total_bs: totBs };
      }
    }));
  };

  // Manejo de precio en bolívares (Bs): respeta si el usuario está ingresando por unidad o el total
  const handlePrecioBsChange = (key: string, val: string) => {
    const clean = onlyDecimal(val);
    const numBs = parseNum(clean);
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const modo = x.modo_precio || 'unidad';
      if (modo === 'total') {
        const totUsdActual = x.total_usd || '';
        const usdVacio = !totUsdActual || totUsdActual === '0' || totUsdActual === '0.00';
        const nuevoTotUsd = usdVacio && rate && rate > 0 && numBs > 0
          ? fmtClean(numBs / rate)
          : totUsdActual;
        const unitBs = numBs > 0 ? fmtClean(numBs / q) : (clean === '' ? '' : '0');
        const numTotUsd = parseNum(nuevoTotUsd);
        const unitUsd = numTotUsd > 0 ? fmtClean(numTotUsd / q) : x.price;
        return { ...x, total_bs: clean, total_usd: nuevoTotUsd, price_bs: unitBs, price: unitUsd };
      } else {
        const usdVacio = !x.price || x.price === '' || x.price === '0' || x.price === '0.00';
        const nuevoUsd = usdVacio && rate && rate > 0 && numBs > 0
          ? fmtClean(numBs / rate)
          : x.price;
        const totBs = numBs > 0 ? fmtClean(numBs * q) : '0';
        const numUsd = parseNum(nuevoUsd);
        const totUsd = numUsd > 0 ? fmtClean(numUsd * q) : '0';
        return { ...x, price_bs: clean, price: nuevoUsd, total_bs: totBs, total_usd: totUsd };
      }
    }));
  };

  // Recomputar manualmente con la tasa BCV (botón 🔄)
  const recomputarDesdeBcv = (key: string, base: 'USD' | 'VES') => {
    if (!rate || rate <= 0) return toast.info('No hay tasa BCV activa para convertir.');
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const modo = x.modo_precio || 'unidad';
      if (base === 'USD') {
        if (modo === 'total') {
          const tU = parseNum(x.total_usd || '0') || (parseNum(x.price) * q);
          const tB = fmtClean(tU * rate);
          return { ...x, total_bs: tB, price_bs: fmtClean((tU * rate) / q) };
        }
        const u = parseNum(x.price);
        const bs = fmtClean(u * rate);
        return { ...x, price_bs: bs, total_bs: fmtClean(u * rate * q) };
      } else {
        if (modo === 'total') {
          const tB = parseNum(x.total_bs || '0') || (parseNum(x.price_bs) * q);
          const tU = fmtClean(tB / rate);
          return { ...x, total_usd: tU, price: fmtClean((tB / rate) / q) };
        }
        const b = parseNum(x.price_bs);
        const u = fmtClean(b / rate);
        return { ...x, price: u, total_usd: fmtClean((b / rate) * q) };
      }
    }));
  };

  // 📋 Cotizaciones / Presupuestos alternativos por renglón (uno o varios presupuestos por ítem)
  const agregarPresupuesto = (key: string) => {
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const list = x.presupuestos || [];
      const nuevo: PresupuestoItem = {
        id: `cot-${Date.now()}-${list.length}`,
        proveedor: '',
        concepto: x.name || '',
        metodo_pago: 'efectivo_usd',
        modo_precio: x.modo_precio || 'unidad',
        precio_usd: '',
        precio_bs: '',
        total_usd: '',
        total_bs: '',
        archivos: [],
        nota: '',
      };
      return { ...x, presupuestos: [...list, nuevo], presupuestosAbierto: true };
    }));
  };

  const cambiarModoPrecioPresupuesto = (key: string, cotId: string, nuevoModo: 'unidad' | 'total') => {
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const list = (x.presupuestos || []).map((c) => {
        if (c.id !== cotId) return c;
        const uU = parseNum(c.precio_usd);
        const uB = parseNum(c.precio_bs);
        const tU = parseNum(c.total_usd || '0') || (uU * q);
        const tB = parseNum(c.total_bs || '0') || (uB * q);
        return {
          ...c,
          modo_precio: nuevoModo,
          total_usd: tU > 0 ? fmtClean(tU) : c.precio_usd,
          total_bs: tB > 0 ? fmtClean(tB) : c.precio_bs,
          precio_usd: tU > 0 ? fmtClean(tU / q) : c.precio_usd,
          precio_bs: tB > 0 ? fmtClean(tB / q) : c.precio_bs,
        };
      });
      return { ...x, presupuestos: list };
    }));
  };

  const actualizarPresupuesto = (key: string, cotId: string, campo: keyof PresupuestoItem, val: string) => {
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const list = (x.presupuestos || []).map((c) => {
        if (c.id !== cotId) return c;
        const modo = c.modo_precio || 'unidad';
        if (campo === 'precio_usd' || campo === 'total_usd') {
          const clean = onlyDecimal(val);
          const numU = parseNum(clean);
          if (modo === 'total') {
            const bsVacio = !c.total_bs || c.total_bs === '0' || c.total_bs === '0.00';
            const nuevoTotBs = bsVacio && rate && rate > 0 && numU > 0 ? fmtClean(numU * rate) : (clean === '' ? '' : (c.total_bs || ''));
            const unitUsd = numU > 0 ? fmtClean(numU / q) : '';
            const numTotBs = parseNum(nuevoTotBs);
            const unitBs = numTotBs > 0 ? fmtClean(numTotBs / q) : c.precio_bs;
            return { ...c, total_usd: clean, total_bs: nuevoTotBs, precio_usd: unitUsd, precio_bs: unitBs };
          } else {
            const bsVacio = !c.precio_bs || c.precio_bs === '0' || c.precio_bs === '0.00';
            const nuevoBs = bsVacio && rate && rate > 0 && numU > 0 ? fmtClean(numU * rate) : (clean === '' ? '' : c.precio_bs);
            const totUsd = numU > 0 ? fmtClean(numU * q) : '';
            const numBs = parseNum(nuevoBs);
            const totBs = numBs > 0 ? fmtClean(numBs * q) : (c.total_bs || '');
            return { ...c, precio_usd: clean, precio_bs: nuevoBs, total_usd: totUsd, total_bs: totBs };
          }
        }
        if (campo === 'precio_bs' || campo === 'total_bs') {
          const clean = onlyDecimal(val);
          const numB = parseNum(clean);
          if (modo === 'total') {
            const usdVacio = !c.total_usd || c.total_usd === '0' || c.total_usd === '0.00';
            const nuevoTotUsd = usdVacio && rate && rate > 0 && numB > 0 ? fmtClean(numB / rate) : (c.total_usd || '');
            const unitBs = numB > 0 ? fmtClean(numB / q) : '';
            const numTotUsd = parseNum(nuevoTotUsd);
            const unitUsd = numTotUsd > 0 ? fmtClean(numTotUsd / q) : c.precio_usd;
            return { ...c, total_bs: clean, total_usd: nuevoTotUsd, precio_bs: unitBs, precio_usd: unitUsd };
          } else {
            const usdVacio = !c.precio_usd || c.precio_usd === '0' || c.precio_usd === '0.00';
            const nuevoUsd = usdVacio && rate && rate > 0 && numB > 0 ? fmtClean(numB / rate) : c.precio_usd;
            const totBs = numB > 0 ? fmtClean(numB * q) : '';
            const numUsd = parseNum(nuevoUsd);
            const totUsd = numUsd > 0 ? fmtClean(numUsd * q) : (c.total_usd || '');
            return { ...c, precio_bs: clean, precio_usd: nuevoUsd, total_bs: totBs, total_usd: totUsd };
          }
        }
        return { ...c, [campo]: val };
      });
      return { ...x, presupuestos: list };
    }));
  };

  // Subir uno o varios soportes (PDF o foto) dentro de un presupuesto comparativo de un renglón
  const [subiendoPresupuestoId, setSubiendoPresupuestoId] = useState<string | null>(null);
  const subirArchivoPresupuestoItem = async (rowKey: string, cotId: string, origen: 'camara' | 'archivo') => {
    setSubiendoPresupuestoId(cotId);
    try {
      const nuevos: FormatoAdjunto[] = [];
      if (origen === 'camara') {
        const res = await captureAndUploadPhoto('requerimientos', `presupuesto-${cotId}`);
        if (!res.ok) { if (res.error) toast.error(res.error); return; }
        if (res.url) {
          nuevos.push({
            id: `pfile-${Date.now()}`,
            url: res.url,
            kind: 'image',
            name: `Foto Presupuesto.jpg`,
          });
        }
      } else {
        const res = await pickAndUploadRequirementFiles(`presupuesto-${cotId}`);
        if (!res.ok) { if (res.error) toast.error(res.error); return; }
        if (res.files && res.files.length > 0) {
          res.files.forEach((f, idx) => {
            nuevos.push({
              id: `pfile-${Date.now()}-${idx}`,
              url: f.url,
              kind: f.kind,
              name: f.name || `Presupuesto ${idx + 1}`,
            });
          });
        }
      }
      if (nuevos.length > 0) {
        setRows((r) => r.map((x) => {
          if (x.key !== rowKey) return x;
          return {
            ...x,
            presupuestos: (x.presupuestos || []).map((c) =>
              c.id === cotId ? { ...c, archivos: [...(c.archivos || []), ...nuevos] } : c
            ),
          };
        }));
        toast.success(`${nuevos.length} presupuesto(s) adjuntado(s).`);
      }
    } finally {
      setSubiendoPresupuestoId(null);
    }
  };

  const quitarArchivoPresupuestoItem = (rowKey: string, cotId: string, fileId: string) => {
    setRows((r) => r.map((x) => {
      if (x.key !== rowKey) return x;
      return {
        ...x,
        presupuestos: (x.presupuestos || []).map((c) =>
          c.id === cotId ? { ...c, archivos: (c.archivos || []).filter((a) => a.id !== fileId) } : c
        ),
      };
    }));
  };

  const eliminarPresupuesto = (key: string, cotId: string) => {
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      return { ...x, presupuestos: (x.presupuestos || []).filter((c) => c.id !== cotId) };
    }));
  };

  const aplicarPresupuestoAlItem = (key: string, cot: PresupuestoItem) => {
    setRows((r) => r.map((x) => {
      if (x.key !== key) return x;
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const modo = cot.modo_precio || 'unidad';
      const uUsd = parseNum(cot.precio_usd);
      const uBs = parseNum(cot.precio_bs);
      const tUsd = parseNum(cot.total_usd || '0') || (uUsd * q);
      const tBs = parseNum(cot.total_bs || '0') || (uBs * q);
      const matchingSupplier = suppliers.find((s) => s.name.trim().toLowerCase() === cot.proveedor.trim().toLowerCase());
      return {
        ...x,
        modo_precio: modo,
        price: uUsd > 0 ? fmtClean(uUsd) : (tUsd > 0 ? fmtClean(tUsd / q) : x.price),
        price_bs: uBs > 0 ? fmtClean(uBs) : (tBs > 0 ? fmtClean(tBs / q) : x.price_bs),
        total_usd: tUsd > 0 ? fmtClean(tUsd) : (uUsd > 0 ? fmtClean(uUsd * q) : x.total_usd),
        total_bs: tBs > 0 ? fmtClean(tBs) : (uBs > 0 ? fmtClean(uBs * q) : x.total_bs),
        supplier_name: cot.proveedor || x.supplier_name,
        supplier_id: matchingSupplier ? matchingSupplier.id : x.supplier_id,
        metodo_pago: cot.metodo_pago || x.metodo_pago,
      };
    }));
    const metObj = METODOS_PAGO_COTIZACION.find((m) => m.key === cot.metodo_pago);
    toast.success(`Presupuesto de "${cot.proveedor || 'Proveedor'}" aplicado al ítem${metObj ? ` (${metObj.icon} ${metObj.label})` : ''}.`);
  };

  // Sube una IMAGEN de referencia de un producto (toma foto o elige de galería) y la
  // deja en esa fila. Se guarda dentro del ítem (JSON) al enviar el requerimiento y
  // sale en el PDF junto a la descripción del producto.
  const subirImagenProducto = async (key: string) => {
    setSubiendoImgKey(key);
    try {
      const res = await captureAndUploadPhoto('requerimientos', 'productos');
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      upd(key, 'image_url', res.url!);
    } finally {
      setSubiendoImgKey(null);
    }
  };

  const nq = norm(q);
  const productos = levels.filter((it) => !nq || norm(it.name).includes(nq) || norm(it.sku ?? '').includes(nq)).slice(0, 25);

  const perfilNombre = async (): Promise<string | null> => {
    if (!uid) return null;
    const { data } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
    return (data as any)?.full_name ?? null;
  };

  // Adjunta formatos (imagen/PDF) AL CREAR/EDITAR: sube uno o varios archivos y los
  // acumula en la lista `formatos`; se guardan junto con el requerimiento al enviar.
  const adjuntarFormatoNuevo = async () => {
    setSubiendoNuevo(true);
    try {
      const folder = editId || `nuevo-${Date.now()}`;
      const res = await pickAndUploadRequirementFiles(folder);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      if (res.files && res.files.length > 0) {
        const nuevos: FormatoAdjunto[] = res.files.map((f, idx) => ({
          id: `fmt-${Date.now()}-${idx}`,
          url: f.url,
          kind: f.kind,
          name: f.name,
        }));
        setFormatos((prev) => [...prev, ...nuevos]);
        toast.success(`${nuevos.length} formato(s) cargado(s) correctamente.`);
      }
    } finally {
      setSubiendoNuevo(false);
    }
  };

  const tomarFotoFormatoNuevo = async () => {
    setSubiendoNuevo(true);
    try {
      const folder = editId || `nuevo-${Date.now()}`;
      const res = await captureAndUploadPhoto('requerimientos', folder);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      if (res.url) {
        const nuevo: FormatoAdjunto = {
          id: `fmt-cam-${Date.now()}`,
          url: res.url,
          kind: 'image',
          name: `Foto_${new Date().toLocaleTimeString('es-VE').replace(/:/g, '-')}.jpg`,
        };
        setFormatos((prev) => [...prev, nuevo]);
        toast.success('Foto adjuntada al requerimiento.');
      }
    } finally {
      setSubiendoNuevo(false);
    }
  };

  const quitarFormato = (id: string) => {
    setFormatos((prev) => prev.filter((f) => f.id !== id));
  };

  /** Deja el formulario en blanco. En UNA función: con 12 campos, resetear a mano
   *  en cada salida terminaba dejando alguno pegado del requerimiento anterior. */
  const limpiarForm = () => {
    setEditId(null); setTitle(''); setNote(''); setCompanyId(null); setSupplierId(null);
    setEmpresaPagadoraId(null); setEmpresaPagadoraNombre(null);
    setAlicuotaIva('16');
    setRows([]); setFormatos([]); setRespId(null); setRespNombre(null);
    setSolicitante(SIN_PERSONA); setAutorizado(SIN_PERSONA);
    setDestino(null); setArea(''); setAreaLibre(false); setCondicionesPago(''); setObservaciones('');
  };

  // 💳 Modal de edición rápida de datos financieros del proveedor
  const abrirEditarPagoProv = (s: Supplier) => {
    setProvParaPago(s);
    setProvBanco(s.bank_name ?? '');
    setProvNumCuenta(s.account_number ?? '');
    setProvTipoCuenta(s.account_type ?? 'Corriente');
    setProvTitular(s.account_holder ?? s.name);
    setProvDocTitular(s.account_id_doc ?? (s.rif ?? ''));
    setProvPagoMovilTel(s.pago_movil_phone ?? (s.phone ?? ''));
    setProvPagoMovilDoc(s.pago_movil_id ?? (s.rif ?? ''));
    setProvPagoMovilBanco(s.pago_movil_bank ?? (s.bank_name ?? ''));
    setProvBinanceId(s.binance_id ?? '');
    const cap = extraerCapturaPago(s);
    setProvPaymentPhotoUrl(cap?.url ?? '');
    setProvPaymentPhotoName(cap?.name ?? '');
    setProvNotasPago(limpiarNotasUsuario(s.payment_notes));
    setModalPagoProvOpen(true);
  };

  const subirCapturaProvArchivo = async () => {
    try {
      setSubiendoCapturaProv(true);
      const res = await pickAndUploadDocFile('proveedores', provParaPago?.id || 'nuevo');
      if (res.ok && res.url) {
        setProvPaymentPhotoUrl(res.url);
        if (!provPaymentPhotoName.trim()) {
          setProvPaymentPhotoName(res.name || 'Captura de pago / QR');
        }
        toast.success('Captura del proveedor cargada con éxito.');
      } else if (res.error) {
        toast.error(res.error);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error al subir captura');
    } finally {
      setSubiendoCapturaProv(false);
    }
  };

  const tomarFotoCapturaProv = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        toast.error('Permiso de cámara denegado.');
        return;
      }
      setSubiendoCapturaProv(true);
      const res = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const folder = 'proveedores';
      const id = provParaPago?.id || 'nuevo';
      const path = `${folder}/${id}/${Date.now()}.jpg`;

      let up: any;
      if (Platform.OS === 'web') {
        const resp = await fetch(asset.uri);
        const blob = await resp.blob();
        up = await supabase.storage.from('machinery').upload(path, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      } else {
        const base64Str = asset.base64 || '';
        const byteCharacters = atob(base64Str);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        up = await supabase.storage.from('machinery').upload(path, byteArray, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      }
      if (up?.error) {
        toast.error(up.error.message);
        return;
      }
      const { data } = supabase.storage.from('machinery').getPublicUrl(path);
      if (data?.publicUrl) {
        setProvPaymentPhotoUrl(data.publicUrl);
        if (!provPaymentPhotoName.trim()) {
          setProvPaymentPhotoName('Foto tomada con cámara');
        }
        toast.success('Foto guardada con éxito.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error al tomar foto');
    } finally {
      setSubiendoCapturaProv(false);
    }
  };

  const guardarPagoProv = async () => {
    if (!provParaPago) return;
    setGuardandoPagoProv(true);
    try {
      const finalNotes = empaquetarNotasConCaptura(provNotasPago, provPaymentPhotoUrl, provPaymentPhotoName);
      const payload = {
        bank_name: provBanco.trim() || null,
        account_number: provNumCuenta.trim() || null,
        account_type: provTipoCuenta.trim() || null,
        account_holder: provTitular.trim() || null,
        account_id_doc: provDocTitular.trim() || null,
        pago_movil_phone: provPagoMovilTel.trim() || null,
        pago_movil_id: provPagoMovilDoc.trim() || null,
        pago_movil_bank: provPagoMovilBanco.trim() || null,
        binance_id: provBinanceId.trim() || null,
        payment_notes: finalNotes,
      };
      const { error } = await supabase.from('suppliers').update(payload).eq('id', provParaPago.id);
      if (error) throw error;
      setModalPagoProvOpen(false);
      await refetch();
      toast.success('Coordenadas de pago del proveedor actualizadas con éxito.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron guardar los datos de pago.');
    } finally {
      setGuardandoPagoProv(false);
    }
  };

  // ── Factura Fiscal / Comercial & Recibo de Pago (Expediente Unificado) ──
  const abrirSubirFactura = (r: InventoryRequirement) => {
    setFacturaTarget(r);
    const fac = extraerFactura(r);
    if (fac) {
      setFacturaNumero(fac.numero);
      setFacturaEmpresa(fac.empresa);
      setFacturaFecha(fac.fecha || new Date().toISOString().slice(0, 10));
      setFacturaUrl(fac.url || null);
      setFacturaTipo(fac.tipo || 'image');
      setFacturaNombre(fac.nombre || null);
    } else {
      setFacturaNumero('');
      setFacturaEmpresa(r.company_id ? 'Inversiones Las Ilusiones' : 'Golden Touch');
      setFacturaFecha(new Date().toISOString().slice(0, 10));
      setFacturaUrl(null);
      setFacturaTipo('image');
      setFacturaNombre(null);
    }

    const rec = extraerReciboPago(r);
    if (rec) {
      setReciboPagoUrl(rec.url || null);
      setReciboPagoTipo(rec.tipo || 'image');
      setReciboPagoNombre(rec.nombre || null);
      setReciboPagoRef(rec.referencia || '');
      setReciboPagoFecha(rec.fecha || new Date().toISOString().slice(0, 10));
      setReciboPagoMetodo(rec.metodo || '');
    } else {
      setReciboPagoUrl(null);
      setReciboPagoTipo('image');
      setReciboPagoNombre(null);
      setReciboPagoRef('');
      setReciboPagoFecha(new Date().toISOString().slice(0, 10));
      setReciboPagoMetodo('');
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

  const subirArchivoReciboPago = async () => {
    if (!facturaTarget) return;
    setSubiendoReciboPago(true);
    try {
      const res = await pickAndUploadRequirementFile(`recibos_pago/${facturaTarget.id}`);
      if (!res.ok) {
        if (res.error) toast.error(res.error);
        return;
      }
      setReciboPagoUrl(res.url || null);
      setReciboPagoTipo(res.kind || 'image');
      setReciboPagoNombre(res.name || 'recibo_pago');
      toast.success('Archivo de recibo de pago cargado.');
    } catch (e: any) {
      toast.error('Error al subir archivo: ' + (e?.message ?? e));
    } finally {
      setSubiendoReciboPago(false);
    }
  };

  const tomarFotoReciboPago = async () => {
    if (!facturaTarget) return;
    setSubiendoReciboPago(true);
    try {
      const res = await captureAndUploadPhoto(`recibos_pago/${facturaTarget.id}`);
      if (!res.ok) {
        if (res.error) toast.error(res.error);
        return;
      }
      setReciboPagoUrl(res.url || null);
      setReciboPagoTipo('image');
      setReciboPagoNombre('Foto Recibo Pago');
      toast.success('Foto de recibo de pago capturada.');
    } catch (e: any) {
      toast.error('Error al capturar foto: ' + (e?.message ?? e));
    } finally {
      setSubiendoReciboPago(false);
    }
  };

  // ── Configuración de Regla de Aprobación por Monto, Empresa y Personas ──
  const abrirConfigModal = () => {
    const cur = obtenerConfigAprobacionMonto();
    setConfigAprobacion(cur);
    setCfgMonto(String(cur.montoLimiteUSD || 1000));
    setCfgEmpresaId(cur.empresaId || null);
    setCfgEmpresaNombre(cur.empresaNombre || 'Todas las empresas');
    setCfgAprobadoresNombres(cur.aprobadoresNombres || ['Gerencia General']);
    setConfigModalOpen(true);
  };

  const guardarConfigModal = () => {
    const m = parseNum(cfgMonto);
    if (!(m > 0)) {
      toast.error('Indica un monto límite válido mayor a 0 USD.');
      return;
    }
    const nuevaRegla: ReglaAprobacionMonto = {
      montoLimiteUSD: m,
      empresaId: cfgEmpresaId,
      empresaNombre: cfgEmpresaNombre,
      aprobadoresIds: [],
      aprobadoresNombres: cfgAprobadoresNombres.length > 0 ? cfgAprobadoresNombres : ['Gerencia General'],
      activo: true,
    };
    guardarConfigAprobacionMonto(nuevaRegla);
    setConfigAprobacion(nuevaRegla);
    setConfigModalOpen(false);
    toast.success(`Regla de aprobación actualizada: > $${m.toLocaleString()} USD (${cfgEmpresaNombre}).`);
  };

  const guardarFacturaModal = async () => {
    if (!facturaTarget) return;
    if (!facturaNumero.trim() && !reciboPagoUrl) {
      toast.error('Indica al menos el número de factura o adjunta un comprobante de pago.');
      return;
    }
    setGuardandoFactura(true);
    try {
      const userName = await perfilNombre();
      let nuevaObs = facturaTarget.observaciones || '';

      let dataFac: FacturaData | null = null;
      if (facturaNumero.trim()) {
        dataFac = {
          numero: facturaNumero.trim(),
          empresa: facturaEmpresa,
          fecha: facturaFecha || new Date().toISOString().slice(0, 10),
          url: facturaUrl || null,
          tipo: facturaTipo || 'image',
          nombre: facturaNombre || null,
          subidaPor: userName || session?.user?.email || 'Administración',
          subidaAt: nowISO(),
        };
        nuevaObs = inyectarFacturaEnObservaciones(nuevaObs, dataFac);
      }

      if (reciboPagoUrl) {
        const dataRec: ReciboPagoData = {
          url: reciboPagoUrl,
          tipo: reciboPagoTipo || 'image',
          nombre: reciboPagoNombre || 'Recibo de pago',
          referencia: reciboPagoRef.trim() || null,
          fecha: reciboPagoFecha || new Date().toISOString().slice(0, 10),
          metodo: reciboPagoMetodo.trim() || null,
          subidoPor: userName || session?.user?.email || 'Administración',
          subidoAt: nowISO(),
        };
        nuevaObs = inyectarReciboPagoEnObservaciones(nuevaObs, dataRec);
      }

      const patchPayload: Record<string, any> = {
        observaciones: nuevaObs,
      };
      if (dataFac?.url && !facturaTarget.attachment_url) {
        patchPayload.attachment_url = dataFac.url;
        patchPayload.attachment_type = dataFac.tipo || 'image';
        patchPayload.attachment_name = dataFac.nombre || `Factura ${dataFac.numero}`;
      }

      const { error } = await supabase
        .from('inventory_requirements')
        .update(patchPayload)
        .eq('id', facturaTarget.id);

      if (error) throw error;

      // Sincronización automática con Cuentas por Pagar si existe una cuenta ligada
      try {
        if (facturaTarget.id || facturaTarget.supplier_id) {
          const { data: ctas } = await supabase
            .from('cuentas')
            .select('id, nota, factura_url')
            .or(`order_id.eq.${facturaTarget.id},supplier_id.eq.${facturaTarget.supplier_id || '00000000-0000-0000-0000-000000000000'}`)
            .limit(1);
          if (ctas && ctas.length > 0) {
            const targetCta = ctas[0];
            const notaCta = inyectarReciboPagoEnNota(
              targetCta.nota,
              reciboPagoUrl ? { url: reciboPagoUrl, tipo: reciboPagoTipo || 'image', nombre: 'Recibo de pago', subidoPor: userName || 'Requerimientos' } : null
            );
            await supabase.from('cuentas').update({
              nota: notaCta,
              factura_url: dataFac?.url || targetCta.factura_url,
              updated_at: nowISO(),
            }).eq('id', targetCta.id);
          }
        }
      } catch (eSync) {
        // Sync silencioso
      }

      setFacturaModalOpen(false);
      setFacturaTarget(null);
      refetch();
      refetchCuentas();
      toast.success('Expediente de Factura y Pago guardado con éxito.');
    } catch (e: any) {
      toast.error('Error al guardar expediente: ' + (e?.message ?? e));
    } finally {
      setGuardandoFactura(false);
    }
  };

  // ↩ Revertir Pago por error (en Requerimiento y en Cuentas por Pagar)
  const revertirPagoRequerimiento = async (r: InventoryRequirement) => {
    const ok = await confirm({
      title: 'Revertir pago por error',
      message: `¿Revertir el pago registrado en ${r.code ?? 'este requerimiento'}?\n\n• Se quitará el comprobante de pago del requerimiento.\n• El requerimiento volverá a estado "Aprobado (Por Pagar)".\n• La Cuenta por Pagar asociada volverá a estado "Pendiente".`,
      confirmText: 'Revertir pago',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      const obsSinRecibo = inyectarReciboPagoEnObservaciones(r.observaciones, null);
      const nextStatus = (r.status === 'esperando_recepcion' || (r.status as string) === 'pagado') ? 'aprobado' : r.status;
      const { error } = await supabase
        .from('inventory_requirements')
        .update({ observaciones: obsSinRecibo, status: nextStatus })
        .eq('id', r.id);
      if (error) throw error;

      // También revertir en Cuentas por Pagar si tiene cuenta asociada
      try {
        const { data: ctas } = await supabase
          .from('cuentas')
          .select('id, nota')
          .eq('order_id', r.id);
        if (ctas && ctas.length > 0) {
          for (const cta of ctas) {
            await supabase.from('cuenta_abonos').delete().eq('cuenta_id', cta.id);
            const notaSinRec = inyectarReciboPagoEnNota(cta.nota, null);
            await supabase.from('cuentas').update({
              estado: 'pendiente',
              settled_by: null,
              settled_at: null,
              nota: notaSinRec,
              updated_at: nowISO(),
            }).eq('id', cta.id);
          }
        }
      } catch (eCxp) {
        console.warn('Error revirtiendo cuenta ligada:', eCxp);
      }

      refetch();
      refetchCuentas();
      toast.success(`Pago revertido en ${r.code}. Volvió a Pendiente por Pagar en Requerimientos y en Cuentas por Pagar.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo revertir el pago.');
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

  // ── Control de Almacén: Despacho Físico ────────────────────────────────────
  const abrirDespachoModal = async (r: InventoryRequirement) => {
    setDespachoTarget(r);
    const desp = extraerDespacho(r);
    const userName = await perfilNombre();
    setRetiradoPor(desp.retiradoPor || r.solicitante_nombre || '');
    setRetiradoCedula(desp.retiradoCedula || '');
    setRetiradoCargo(desp.retiradoCargo || '');
    setRetiradoEmployeeId(desp.retiradoEmployeeId || null);
    setDespachadoPor(desp.despachadoPor || userName || 'Almacén');
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
      const userName = await perfilNombre();
      const maqObj = machines.find((m) => m.id === despachoMaquinariaId);
      const dataDespacho: DespachoAlmacenData = {
        estado: 'retirado',
        retiradoPor: retiradoPor.trim(),
        retiradoCedula: retiradoCedula.trim() || null,
        retiradoCargo: retiradoCargo.trim() || null,
        retiradoEmployeeId: retiradoEmployeeId || null,
        despachadoPor: userName || despachadoPor || 'Almacén',
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

  // ── Generación de Expediente Completo (PDF) ───────────────────────────────
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
        maquinariaLabel: maqLabel || destinoLabel(r.destino_tipo) || 'Destino asignado',
        itemsConImagenes,
      });

      await exportPdf(html, `Expediente-${r.code || 'REQ'}`);
      toast.success('Expediente generado exitosamente.');
    } catch (err: any) {
      toast.error('Error al generar expediente: ' + (err?.message ?? err));
    }
  };

  // 🔄 Ciclo de Retroalimentación Técnica (Bucle de Cotización)
  const abrirSolicitarAclaratoria = (r: InventoryRequirement) => {
    setAclaratoriaTarget(r);
    setAclaratoriaMotivo('');
    setAclaratoriaOpen(true);
  };

  const enviarSolicitudAclaratoria = async () => {
    if (!aclaratoriaTarget) return;
    if (!aclaratoriaMotivo.trim()) {
      toast.error('Indica qué especificaciones o aclaratorias técnicas exige el proveedor.');
      return;
    }
    setAclaratoriaBusy(true);
    try {
      const decName = await perfilNombre();
      const { error } = await supabase.from('inventory_requirements').update({
        status: 'aclaratoria_solicitada',
        aclaratoria_motivo: aclaratoriaMotivo.trim(),
        aclaratoria_solicitada_por: decName || session?.user?.email || 'Compras',
        aclaratoria_fecha_solicitud: nowISO(),
      }).eq('id', aclaratoriaTarget.id);
      if (error) throw error;
      setAclaratoriaOpen(false);
      setAclaratoriaTarget(null);
      refetch();
      toast.info('Ticket devuelto al solicitante con solicitud de aclaratoria técnica.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo enviar la solicitud de aclaratoria.');
    } finally {
      setAclaratoriaBusy(false);
    }
  };

  // 📝 Responder Aclaratoria Técnica (Solicitante)
  const abrirResponderAclaratoria = (r: InventoryRequirement) => {
    setRespuestaTarget(r);
    setRespuestaTexto(r.aclaratoria_respuesta ?? '');
    setRespuestaOpen(true);
  };

  const enviarRespuestaAclaratoria = async () => {
    if (!respuestaTarget) return;
    if (!respuestaTexto.trim()) {
      toast.error('Escribe los detalles técnicos solicitados (medidas, material, etc.).');
      return;
    }
    setRespuestaBusy(true);
    try {
      const { error } = await supabase.from('inventory_requirements').update({
        status: 'pendiente', // vuelve a la cola de revisión
        aclaratoria_respuesta: respuestaTexto.trim(),
        aclaratoria_fecha_respuesta: nowISO(),
      }).eq('id', respuestaTarget.id);
      if (error) throw error;
      setRespuestaOpen(false);
      setRespuestaTarget(null);
      refetch();
      toast.success('Aclaratoria técnica enviada. El ticket volvió a revisión de compras.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo enviar la respuesta.');
    } finally {
      setRespuestaBusy(false);
    }
  };

  const crear = async () => {
    setFormErr(null);
    const alicNum = Math.min(100, Math.max(0, parseNum(alicuotaIva) || 0));
    const items: RequirementLine[] = rows.filter((x) => x.name.trim()).map((x) => {
      const supObj = x.supplier_id ? suppliers.find((s) => s.id === x.supplier_id) : (supplierId ? suppliers.find((s) => s.id === supplierId) : null);
      const q = Math.max(0.0001, parseNum(x.qty) || 1);
      const modo = x.modo_precio || 'unidad';
      const rawTotalUsd = parseNum(x.total_usd || '0');
      const rawUnitUsd = parseNum(x.price);
      const pUsd = modo === 'total' && rawTotalUsd > 0 ? Math.round((rawTotalUsd / q) * 10000) / 10000 : rawUnitUsd;
      const totUsd = modo === 'total' && rawTotalUsd > 0 ? rawTotalUsd : Math.round(pUsd * q * 100) / 100;

      const rawTotalBs = parseNum(x.total_bs || '0');
      const rawUnitBs = parseNum(x.price_bs);
      const pBs = modo === 'total' && rawTotalBs > 0
        ? Math.round((rawTotalBs / q) * 100) / 100
        : (rawUnitBs || (rate && rate > 0 ? Math.round(pUsd * rate * 100) / 100 : 0));
      const totBs = modo === 'total' && rawTotalBs > 0
        ? rawTotalBs
        : (pBs > 0 ? Math.round(pBs * q * 100) / 100 : (rate && rate > 0 ? Math.round(totUsd * rate * 100) / 100 : 0));

      return {
        product_id: x.product_id,
        name: x.name.trim().toUpperCase(),
        unit: x.unit.trim().toUpperCase() || null,
        qty: parseNum(x.qty),
        modo_precio: modo,
        est_price: pUsd,
        price_usd: pUsd,
        price_bs: pBs,
        total_usd: totUsd,
        total_bs: totBs,
        currency: 'USD',
        note: x.note.trim() || null,
        image_url: x.image_url || null,
        supplier_id: x.supplier_id || supplierId || null,
        supplier_name: x.supplier_name || supObj?.name || null,
        exento: Boolean(x.exento),
        cotizaciones: (x.presupuestos || []).filter((c) => c.proveedor.trim() || parseNum(c.precio_usd) > 0 || parseNum(c.precio_bs) > 0 || parseNum(c.total_usd || '0') > 0 || parseNum(c.total_bs || '0') > 0 || (c.archivos && c.archivos.length > 0)).map((c) => ({
          id: c.id,
          proveedor: c.proveedor.trim().toUpperCase(),
          concepto: (c.concepto || x.name || '').trim().toUpperCase() || null,
          metodo_pago: c.metodo_pago || null,
          modo_precio: c.modo_precio || 'unidad',
          precio_usd: parseNum(c.precio_usd),
          precio_bs: parseNum(c.precio_bs),
          total_usd: parseNum(c.total_usd || '0') || (parseNum(c.precio_usd) * q),
          total_bs: parseNum(c.total_bs || '0') || (parseNum(c.precio_bs) * q),
          archivos: c.archivos || [],
          nota: (c.nota || '').trim() || null,
        })),
        metodo_pago: x.metodo_pago || null,
      };
    });
    if (items.length === 0) { const m = 'Agrega al menos un producto (del inventario o nuevo) antes de guardar.'; setFormErr(m); return toast.error(m); }
    setBusy(true);

    const primerFmt = formatos[0] || null;
    const obsConCondiciones = inyectarCondicionesPagoEnNota(observaciones.trim() || null, condicionesPago.trim() || null) ?? '';
    const conFormatos = empaquetarFormatosEnObservaciones(obsConCondiciones, formatos);
    const adj = primerFmt ? {
      attachment_url: primerFmt.url,
      attachment_type: primerFmt.kind,
      attachment_name: primerFmt.name,
    } : {
      attachment_url: null,
      attachment_type: null,
      attachment_name: null,
    };

    // EDITAR: actualiza el requerimiento existente (conserva su código y estado).
    // Columna nueva (17-oct-2026): si el SQL del responsable aún no se corrió, el
    // guardado NO se cae — se reintenta sin esos campos y se avisa.
    const faltaColResp = (msg: string) => /responsable/i.test(msg) && /column|does not exist|schema cache|no existe/i.test(msg);
    if (editId) {
      const base = {
        title: title.trim() || null, note: note.trim() || null, company_id: companyId, supplier_id: supplierId,
        empresa_pagadora_id: empresaPagadoraId, empresa_pagadora_nombre: empresaPagadoraNombre,
        iva_alicuota: alicNum,
        items, ...adj
      };
      // 👤 Solicitante, autorizado, destino, área y observaciones (20-oct-2026).
      const conResp = { ...base, responsable_id: respId, responsable_nombre: respNombre };
      const nuevos = camposRequerimiento({ solicitante, autorizado, destino, area, observaciones: conFormatos });
      let respGuardado = true;
      let nuevosGuardados = true;
      let { error } = await supabase.from('inventory_requirements').update({ ...conResp, ...nuevos }).eq('id', editId);
      // Si el SQL de iva_alicuota aún no se corrió, reintenta sin ella
      if (error && /iva_alicuota/i.test(error.message)) {
        delete (conResp as any).iva_alicuota;
        delete (base as any).iva_alicuota;
        ({ error } = await supabase.from('inventory_requirements').update({ ...conResp, ...nuevos }).eq('id', editId));
      }
      // Si el SQL de empresa pagadora aún no se corrió, reintenta sin ella
      if (error && /empresa_pagadora/i.test(error.message)) {
        delete (conResp as any).empresa_pagadora_id;
        delete (conResp as any).empresa_pagadora_nombre;
        ({ error } = await supabase.from('inventory_requirements').update({ ...conResp, ...nuevos }).eq('id', editId));
      }
      // Si el SQL del 20-oct todavía no se corrió, se guarda SIN esos campos en vez
      // de perder la edición entera (mismo trato que tuvo el responsable el 17-oct).
      if (error && faltaColumnaNueva(error.message)) {
        nuevosGuardados = false;
        ({ error } = await supabase.from('inventory_requirements').update(conResp).eq('id', editId));
      }
      if (error && faltaColResp(error.message)) {
        respGuardado = false;
        ({ error } = await supabase.from('inventory_requirements').update(base).eq('id', editId));
      }
      setBusy(false);
      if (error) { setFormErr(error.message); return toast.error(error.message); }
      // Sincronizar condiciones de pago hacia la cuenta por pagar vinculada (si existe)
      try {
        const { data: cxpRows } = await supabase
          .from('cuentas')
          .select('id, nota')
          .or(`inventory_requirement_id.eq.${editId},order_id.eq.${editId}`);
        if (cxpRows && cxpRows.length > 0) {
          for (const cxp of cxpRows) {
            const nuevaNotaCxp = inyectarCondicionesPagoEnNota(cxp.nota, condicionesPago.trim() || null);
            await supabase.from('cuentas').update({ nota: nuevaNotaCxp }).eq('id', cxp.id);
          }
        }
      } catch {}
      setCreateOpen(false); limpiarForm();
      refetch();
      const faltas = [!respGuardado ? 'el responsable' : '', !nuevosGuardados ? 'quién solicitó/autorizó, el área y las observaciones' : '']
        .filter(Boolean).join(' ni ');
      toast.success(faltas
        ? `Requerimiento actualizado (no se guardó ${faltas}: falta correr el SQL).`
        : 'Requerimiento actualizado.');
      return;
    }
    // CREAR: código correlativo (REQ-000N). Se lee el máximo actual; si la lectura
    // FALLA, se ABORTA (NUNCA se reinicia a 0001 con una lectura vacía). El índice
    // único en `code` impide duplicados; si dos requerimientos chocan en el mismo
    // código, se reintenta con el siguiente número.
    const reqName = await perfilNombre();
    let code = '';
    let saved = false;
    // Campos del responsable: si la columna aún no existe (falta el SQL), se quitan
    // y el requerimiento se guarda igual — el AVISO al almacenista sí se envía.
    let respCampos: Record<string, any> = respId ? { responsable_id: respId, responsable_nombre: respNombre } : {};
    let respFaltaSql = false;
    // 🏢 Empresa Pagadora (22-oct-2026): entidad responsable del desembolso
    let empresaCampos: Record<string, any> = empresaPagadoraId ? { empresa_pagadora_id: empresaPagadoraId, empresa_pagadora_nombre: empresaPagadoraNombre } : {};
    let empresaFaltaSql = false;
    // 👤 Lo pedido el 20-oct: quién solicitó, quién autorizó, para qué, a qué área
    //    y las observaciones. Mismo trato defensivo que el responsable.
    let nuevosCampos: Record<string, any> = camposRequerimiento({ solicitante, autorizado, destino, area, observaciones: conFormatos });
    let nuevosFaltaSql = false;
    let ivaCampos: Record<string, any> = { iva_alicuota: alicNum };
    for (let intento = 0; intento < 6 && !saved; intento++) {
      const { data: codeRows, error: readErr } = await supabase.from('inventory_requirements').select('code');
      if (readErr || !codeRows) {
        setBusy(false);
        const m = 'No se pudo leer el número de requerimiento (correlativo). Revisa tu conexión e inténtalo de nuevo.';
        setFormErr(m); return toast.error(m);
      }
      code = nextReqCode(codeRows.map((r: any) => r.code), intento);
      // La BASE reasigna el código con un trigger (correlativo a prueba de fallos);
      // leemos el código REAL que quedó para mostrarlo.
      const { data: inserted, error } = await supabase.from('inventory_requirements').insert({
        code, title: title.trim() || null, note: note.trim() || null, company_id: companyId, supplier_id: supplierId, status: 'pendiente', items,
        requested_by: uid, requested_by_name: reqName, ...adj, ...respCampos, ...nuevosCampos, ...empresaCampos, ...ivaCampos,
      }).select('id, code').single();
      if (!error) { if ((inserted as any)?.code) code = (inserted as any).code; saved = true; break; }
      // Falta la columna de iva_alicuota: se reintenta sin ella
      if (Object.keys(ivaCampos).length && /iva_alicuota/i.test(error.message)) { ivaCampos = {}; intento--; continue; }
      // Falta la columna de empresa pagadora: se reintenta sin ella
      if (Object.keys(empresaCampos).length && /empresa_pagadora/i.test(error.message)) { empresaCampos = {}; empresaFaltaSql = true; intento--; continue; }
      // Falta la columna del responsable: se reintenta SIN ella (mismo número).
      if (Object.keys(respCampos).length && faltaColResp(error.message)) { respCampos = {}; respFaltaSql = true; intento--; continue; }
      // Faltan las columnas del 20-oct: igual, se reintenta sin ellas.
      if (Object.keys(nuevosCampos).length && faltaColumnaNueva(error.message)) { nuevosCampos = {}; nuevosFaltaSql = true; intento--; continue; }
      // Código ya usado (índice único): reintenta con el siguiente número.
      if (/duplicate key|already exists|unique|_code_key|23505/i.test(error.message)) continue;
      setBusy(false);
      setFormErr(error.message); return toast.error(error.message);
    }
    setBusy(false);
    if (!saved) { const m = 'No se pudo asignar un número único al requerimiento. Inténtalo de nuevo.'; setFormErr(m); return toast.error(m); }
    // 🔔 EL AVISO AL RESPONSABLE LO MANDA LA BASE, NO LA APP (18-oct-2026). El
    // trigger trg_notify_requirement_responsable (gemelo del que avisa a los admin)
    // crea la notificación dirigida (recipient_id) al INSERTAR con responsable y al
    // CAMBIARLO en ✏️ Editar. Desde la app NO se inserta: la política notif_insert
    // exige is_staff() y los almacenistas son rol base 'conductor' — un aviso
    // insertado desde el cliente se les caía EN SILENCIO (borrados-que-fingen-éxito,
    // versión insert). El trigger es SECURITY DEFINER y no depende de quién crea.
    setCreateOpen(false); limpiarForm();
    refetch();
    const sinSql = [
      respFaltaSql ? 'el responsable' : '',
      nuevosFaltaSql ? 'quién solicitó/autorizó, el área y las observaciones' : '',
      empresaFaltaSql ? 'la empresa pagadora' : '',
    ].filter(Boolean).join(' ni ');
    toast.success(sinSql
      ? `Requerimiento ${code} enviado. ⚠️ No se guardó ${sinSql} (falta correr el SQL); el aviso sí se envió.`
      : `Requerimiento ${code} enviado. El jefe podrá aprobarlo o rechazarlo.`);
  };

  // Abrir el formulario para EDITAR: precarga título, nota e ítems del requerimiento.
  const abrirEditar = (r: InventoryRequirement) => {
    setEditId(r.id);
    setTitle(r.title ?? '');
    setNote(r.note ?? '');
    setCompanyId(r.company_id ?? null);
    setSupplierId(r.supplier_id ?? null);
    setEmpresaPagadoraId(r.empresa_pagadora_id ?? null);
    setEmpresaPagadoraNombre(r.empresa_pagadora_nombre ?? null);
    setRespId(r.responsable_id ?? null);
    setRespNombre(r.responsable_nombre ?? null);
    // 👤 Lo del 20-oct. Un requerimiento viejo no los trae: quedan en blanco y el
    //    formulario se ve igual que siempre.
    setSolicitante({ nombre: r.solicitante_nombre ?? null, employeeId: r.solicitante_employee_id ?? null });
    setAutorizado({ nombre: r.autorizado_nombre ?? null, employeeId: r.autorizado_employee_id ?? null });
    setDestino(r.destino_tipo ?? null);
    setArea(r.area ?? '');
    setAreaLibre(false);
    setCondicionesPago(extraerCondicionesPago(r.observaciones));
    setObservaciones(limpiarCondicionesPagoDeNota(limpiarObservacionesFormatos(r.observaciones ?? '')));
    setAlicuotaIva(r.iva_alicuota != null ? String(r.iva_alicuota) : '16');
    setFormatos(extraerFormatosAdjuntos(r));
    let s = 0;
    setRows(r.items.map((it) => {
      const q = Math.max(0.0001, Number(it.qty) || 1);
      const pUsdNum = it.price_usd != null ? it.price_usd : (it.currency === 'USD' ? Number(it.est_price) || 0 : usdFromBs(Number(it.est_price) || 0, rate || 0));
      const pBsNum = it.price_bs != null ? it.price_bs : (it.currency === 'VES' ? Number(it.est_price) || 0 : (rate && rate > 0 ? Math.round(pUsdNum * rate * 100) / 100 : 0));
      const totUsdNum = it.total_usd != null && Number(it.total_usd) > 0 ? Number(it.total_usd) : Math.round(pUsdNum * q * 100) / 100;
      const totBsNum = it.total_bs != null && Number(it.total_bs) > 0 ? Number(it.total_bs) : Math.round(pBsNum * q * 100) / 100;
      return {
        key: `${Date.now()}-${s++}`,
        product_id: it.product_id,
        name: it.name,
        unit: it.unit ?? '',
        qty: String(it.qty),
        modo_precio: it.modo_precio || 'unidad',
        price: String(pUsdNum),
        price_bs: String(pBsNum),
        total_usd: String(totUsdNum),
        total_bs: String(totBsNum),
        currency: 'USD',
        note: it.note ?? '',
        image_url: it.image_url ?? '',
        supplier_id: it.supplier_id || null,
        supplier_name: it.supplier_name || null,
        metodo_pago: (it as any).metodo_pago || null,
        exento: Boolean(it.exento),
        presupuestos: Array.isArray(it.cotizaciones) ? it.cotizaciones.map((c: any, ci: number) => {
          const cUnitUsd = Number(c.precio_usd ?? c.price ?? 0);
          const cUnitBs = Number(c.precio_bs ?? (rate && rate > 0 ? Math.round(cUnitUsd * rate * 100) / 100 : 0));
          const cTotUsd = c.total_usd != null && Number(c.total_usd) > 0 ? Number(c.total_usd) : Math.round(cUnitUsd * q * 100) / 100;
          const cTotBs = c.total_bs != null && Number(c.total_bs) > 0 ? Number(c.total_bs) : Math.round(cUnitBs * q * 100) / 100;
          return {
            id: c.id || `cot-${ci}-${Date.now()}`,
            proveedor: c.proveedor || c.supplier_name || '',
            concepto: c.concepto || it.name || '',
            metodo_pago: c.metodo_pago || 'efectivo_usd',
            modo_precio: c.modo_precio || 'unidad',
            precio_usd: String(cUnitUsd),
            precio_bs: String(cUnitBs),
            total_usd: String(cTotUsd),
            total_bs: String(cTotBs),
            archivos: Array.isArray(c.archivos) ? c.archivos : [],
            nota: c.nota || c.note || '',
          };
        }) : [],
        presupuestosAbierto: false,
      };
    }));
    setFormErr(null);
    setCreateOpen(true);
  };

  // Aprobación de seguridad para requerimientos > $1,000 USD
  const aprobarGerenteGeneral = async (r: InventoryRequirement) => {
    const decName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').update({
      gerente_aprobado: true,
      gerente_aprobado_por: decName,
      gerente_aprobado_at: nowISO(),
    }).eq('id', r.id);
    if (error) return toast.error(error.message);
    refetch();
    toast.success(`Requerimiento ${r.code} aprobado por Gerente General (> $1,000 USD). Pasa a espera de pago.`);
  };

  // Eliminar TODO el requerimiento (con confirmación). No revierte movimientos de
  // inventario ya registrados si estaba "recibido"; solo borra el documento.
  const eliminar = async (r: InventoryRequirement) => {
    const recibido = r.status === 'recibido';
    const ok = await confirm({
      title: 'Eliminar requerimiento',
      message: `¿Eliminar el requerimiento ${r.code ?? ''}? Esta acción no se puede deshacer.` +
        (recibido ? '\n\nNota: ya fue recibido en inventario; sus entradas de stock NO se revierten.' : ''),
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('inventory_requirements').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    refetch();
  };

  const decidir = async (r: InventoryRequirement, status: 'aprobado' | 'rechazado') => {
    if (r.status === 'aclaratoria_solicitada' && status === 'aprobado') {
      return toast.error('No se puede aprobar un requerimiento con aclaratoria técnica pendiente. Espera la respuesta técnica del solicitante.');
    }
    const decName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').update({
      status, decided_by: uid, decided_by_name: decName, decided_at: nowISO(),
    }).eq('id', r.id);
    if (error) return toast.error(error.message);
    refetch();
    // Al APROBAR, si trae formato adjunto, se abre la vista previa para ver y descargar.
    if (status === 'aprobado' && r.attachment_url) setPreviewReq({ ...r, status });
  };

  // APROBACIÓN EN LOTE: el gerente marca (☑) varios requerimientos PENDIENTES y los
  // aprueba todos de un click. Solo toca los pendientes seleccionados; el trigger
  // req_sync_compra genera la orden/cuenta de cada uno igual que al aprobar uno a uno.
  const aprobarLote = async () => {
    const ids = reqs.filter((r) => reqSelIds.has(r.id) && r.status === 'pendiente').map((r) => r.id);
    if (!ids.length) return toast.error('Marca (☑) requerimientos PENDIENTES para aprobar en lote.');
    const ok = await confirm({ title: 'Aprobar en lote', message: `¿Aprobar ${ids.length} requerimiento(s) pendiente(s) de una vez?`, confirmText: `Aprobar ${ids.length}` });
    if (!ok) return;
    const decName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').update({ status: 'aprobado', decided_by: uid, decided_by_name: decName, decided_at: nowISO() }).in('id', ids);
    if (error) return toast.error(error.message);
    setReqSelIds(new Set());
    refetch();
    toast.success(`${ids.length} requerimiento(s) aprobados en lote.`);
  };

  // ANULAR un requerimiento YA APROBADO: el mismo gerente lo rechaza. Pasa a
  // RECHAZADO y el trigger de la BD (req_sync_compra) anula automáticamente la
  // orden de compra y la cuenta por pagar que se hubieran generado. No revierte
  // stock ya recibido (para eso está "recibido", que no permite anular acá).
  const anularAprobado = async (r: InventoryRequirement) => {
    const ok = await confirm({
      title: 'Anular requerimiento aprobado',
      message: `¿Anular (rechazar) el requerimiento ${r.code ?? ''} que ya estaba APROBADO?\n\n` +
        'Quedará RECHAZADO y, si generó orden de compra y cuenta por pagar, se anulan automáticamente. No revierte stock ya recibido.',
      confirmText: 'Anular / Rechazar', cancelText: 'Cancelar', danger: true,
    });
    if (!ok) return;
    await decidir(r, 'rechazado');
  };

  // Sube uno o más FORMATOS (imágenes o PDFs) al requerimiento y los guarda en la fila.
  const subirFormato = async (r: InventoryRequirement) => {
    setSubiendoId(r.id);
    try {
      const res = await pickAndUploadRequirementFiles(r.id);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      if (!res.files || res.files.length === 0) return;

      const actuales = extraerFormatosAdjuntos(r);
      const nuevos: FormatoAdjunto[] = res.files.map((f, idx) => ({
        id: `fmt-${Date.now()}-${idx}`,
        url: f.url,
        kind: f.kind,
        name: f.name,
      }));
      const combinados = [...actuales, ...nuevos];
      const conFormatos = empaquetarFormatosEnObservaciones(r.observaciones, combinados);
      const primerFmt = combinados[0] || null;

      const { data, error } = await supabase.from('inventory_requirements')
        .update({
          attachment_url: primerFmt?.url ?? null,
          attachment_type: primerFmt?.kind ?? null,
          attachment_name: primerFmt?.name ?? null,
          observaciones: conFormatos,
        })
        .eq('id', r.id).select('id');
      if (error) {
        if (/attachment|column/i.test(error.message)) { toast.error('Corre "requerimientos_adjunto.sql" en Supabase para guardar el formato.'); return; }
        toast.error(error.message); return;
      }
      if (!data || data.length === 0) { toast.error('No tienes permiso de escritura en inventario.'); return; }
      await refetch();
      toast.success(`${nuevos.length} formato(s) guardado(s) en el requerimiento.`);
    } finally {
      setSubiendoId(null);
    }
  };

  // Descarga (o abre) el formato adjunto.
  const descargarFormato = (r: InventoryRequirement, formatoItem?: FormatoAdjunto | null) => {
    const fmts = extraerFormatosAdjuntos(r);
    const target = formatoItem || fmts[0] || (r.attachment_url ? { url: r.attachment_url, name: r.attachment_name } : null);
    if (!target?.url) return;
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = target.url; a.download = target.name || 'formato'; a.target = '_blank'; a.rel = 'noopener';
      a.click();
    } else {
      Linking.openURL(target.url);
    }
  };

  // Revierte un requerimiento RECHAZADO de vuelta a PENDIENTE (p. ej. si el rechazo
  // fue un error de dedo). Limpia la decisión y NOTIFICA a los admin (el trigger de
  // la BD solo notifica al crear; al revertir insertamos la notificación a mano).
  const revertirRechazo = async (r: InventoryRequirement) => {
    const ok = await confirm({
      title: 'Volver a pendiente',
      message: `¿Devolver el requerimiento ${r.code ?? ''} a estado PENDIENTE? Se notificará a los administradores.`,
      confirmText: 'Volver a pendiente', cancelText: 'Cancelar',
    });
    if (!ok) return;
    const { data, error } = await supabase.from('inventory_requirements')
      .update({ status: 'pendiente', decided_by: null, decided_by_name: null, decided_at: null })
      .eq('id', r.id).select();
    if (error) { await confirm({ title: 'No se pudo', message: error.message, confirmText: 'OK', cancelText: '' }); return; }
    if (!data || data.length === 0) { await confirm({ title: 'No se pudo', message: 'No tienes permiso o el requerimiento ya no existe.', confirmText: 'OK', cancelText: '' }); return; }
    // Notifica a los admin que el requerimiento volvió a PENDIENTE.
    try {
      await supabase.from('notifications').insert({
        type: 'requerimiento',
        title: 'Requerimiento de vuelta a pendiente',
        body: [r.code, r.title].filter(Boolean).join(' · '),
        target_role: 'admin', entity_type: 'inventory_requirement', entity_id: String(r.id),
        created_by: uid, meta: { code: r.code, status: 'pendiente' },
      });
    } catch { }
    refetch();
  };

  // Cambio de estado MANUAL (corrección administrativa): a diferencia de "Recibir
  // en inventario" (que crea las entradas de stock), esto SOLO cambia la etiqueta
  // del documento — pedido directo del cliente (04/08/2026) para poder corregir un
  // estado sin tener que rehacer todo el flujo. Solo para quien tenga `canReceive`.
  const [statusPickerId, setStatusPickerId] = useState<string | null>(null);
  const cambiarEstadoManual = async (r: InventoryRequirement, status: RequirementStatus) => {
    const ok = await confirm({
      title: 'Cambiar estado manualmente',
      message: `¿Cambiar ${r.code ?? ''} a "${REQ_STATUS[status].short}"? Esto SOLO cambia la etiqueta del documento — no crea ni revierte entradas de stock en el inventario.` +
        (status === 'recibido' ? '\n\nSi todavía no se recibió físicamente, usa "📥 Recibir en inventario" en su lugar para que el stock quede registrado.' : ''),
      confirmText: 'Cambiar', cancelText: 'Cancelar',
    });
    if (!ok) return;
    const patch: Record<string, any> = { status };
    if (status === 'recibido' && !r.received_at) patch.received_at = nowISO();
    const { error } = await supabase.from('inventory_requirements').update(patch).eq('id', r.id);
    if (error) return toast.error(error.message);
    setStatusPickerId(null);
    refetch();
    toast.success('Estado actualizado.');
  };

  // Abrir "Recibir": precarga los ítems con su precio estimado (para editarlo al real).
  const abrirRecibir = (r: InventoryRequirement) => {
    setRecvFor(r);
    setRecvRows(r.items.map((it) => ({
      product_id: it.product_id,
      name: it.name,
      unit: it.unit,
      qty: String(it.qty),
      price: String(it.est_price || 0),
      currency: it.currency || 'USD',
      note: it.note ?? '',
    })));
    setRecvFacturaNumero('');
    setRecvFacturaUrl(null);
    setRecvFacturaTipo(null);
    setRecvFacturaNombre(null);
    setRecvNota('');
  };

  const recibir = async () => {
    if (!recvFor) return;
    for (const it of recvRows) { if (parseNum(it.qty) <= 0) return toast.error(`Indica la cantidad recibida de "${it.name}".`); }
    setRecvBusy(true);
    // SKU incremental para los productos NUEVOS.
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    let maxN = 0;
    (skuRows ?? []).forEach((r: any) => { const m = String(r.sku ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; } });
    const pad = (n: number) => 'INV-' + String(n).padStart(4, '0');
    const notaGenTrim = recvNota.trim();
    try {
      for (const it of recvRows) {
        let itemId = it.product_id;
        const lineItem = recvFor.items.find((x) => x.product_id === it.product_id || norm(x.name) === norm(it.name));
        const linePhoto = lineItem?.image_url || (it as any).image_url || null;
        if (!itemId) { // producto NUEVO: se crea a raíz del requerimiento
          maxN += 1;
          const { data: ins, error } = await supabase.from('inventory_items')
            .insert({ name: it.name.toUpperCase(), unit: it.unit || null, sku: pad(maxN), category: 'otros', min_stock: 0, machinery_id: null, company_id: null, ...(linePhoto ? { image_url: linePhoto } : {}) })
            .select('id').single();
          if (error) throw error;
          itemId = ins.id;
        } else if (linePhoto) {
          try {
            await supabase.from('inventory_items').update({ image_url: linePhoto }).eq('id', itemId);
          } catch { }
        }
        const priceUsd = it.currency === 'USD' ? parseNum(it.price) : usdFromBs(parseNum(it.price), rate || 0);
        const notaItemTrim = (it.note || '').trim();
        const detalleRazon = [
          `RECIBIDO DE REQUERIMIENTO ${recvFor.code ?? ''}`.trim(),
          notaItemTrim ? `Nota ítem: ${notaItemTrim}` : '',
          notaGenTrim ? `Nota recepción: ${notaGenTrim}` : '',
        ].filter(Boolean).join(' · ');
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: itemId, kind: 'entrada', qty: parseNum(it.qty), unit_cost: Math.round((priceUsd || 0) * 10000) / 10000,
          reason: detalleRazon, company_id: null, created_by: uid,
        });
        if (mErr) throw mErr;
      }
      const items2 = recvFor.items.map((it, idx) => {
        const rowMatch = recvRows[idx];
        const nextNote = rowMatch?.note != null && rowMatch.note.trim() ? rowMatch.note.trim() : it.note;
        return { ...it, note: nextNote, received: true };
      });
      const partesRecepcion = [
        recvFacturaNumero.trim() ? `Factura N° ${recvFacturaNumero.trim()}${recvFacturaUrl ? ' (con soporte adjunto)' : ''}` : '',
        notaGenTrim ? `Nota: ${notaGenTrim}` : '',
      ].filter(Boolean).join(' · ');
      const obsFinal = `${recvFor.observaciones || ''}${partesRecepcion ? `\n[RECEPCIÓN ALMACÉN: ${partesRecepcion}]` : ''}`.trim() || null;

      const reqPatch: Record<string, any> = {
        status: 'recibido',
        received_at: nowISO(),
        items: items2,
        observaciones: obsFinal,
      };
      if (recvFacturaUrl && !recvFor.attachment_url) {
        reqPatch.attachment_url = recvFacturaUrl;
        reqPatch.attachment_type = recvFacturaTipo || 'image';
        reqPatch.attachment_name = recvFacturaNombre || `Factura ${recvFacturaNumero || recvFor.code}`;
      }

      const { error: uErr } = await supabase.from('inventory_requirements').update(reqPatch).eq('id', recvFor.id);
      if (uErr) throw uErr;

      // 🧾 Sincronización automática con Cuentas por Pagar
      if (recvFor.supplier_id) {
        try {
          const totalMontoRecv = recvRows.reduce((s, it) => {
            const pr = it.currency === 'USD' ? parseNum(it.price) : usdFromBs(parseNum(it.price), rate || 0);
            return s + pr * parseNum(it.qty);
          }, 0);

          const { data: existCxp } = await supabase
            .from('cuentas')
            .select('id, nota')
            .eq('order_id', recvFor.id)
            .limit(1);

          if (existCxp && existCxp.length > 0) {
            const prevNota = (existCxp[0] as any).nota || '';
            const nuevaNotaCxp = notaGenTrim
              ? `${prevNota ? prevNota + ' · ' : ''}Nota recepción almacén: ${notaGenTrim}`
              : undefined;
            await supabase
              .from('cuentas')
              .update({
                documento: recvFacturaNumero.trim() || undefined,
                factura_url: recvFacturaUrl || undefined,
                monto: totalMontoRecv > 0 ? totalMontoRecv : undefined,
                ...(nuevaNotaCxp ? { nota: nuevaNotaCxp } : {}),
                updated_at: nowISO(),
              })
              .eq('id', existCxp[0].id);
          } else {
            await supabase.from('cuentas').insert({
              tipo: 'por_pagar',
              supplier_id: recvFor.supplier_id,
              order_id: recvFor.id,
              concepto: `Compra recibida en almacén: ${recvFor.title || recvFor.code}`,
              documento: recvFacturaNumero.trim() || null,
              factura_url: recvFacturaUrl || null,
              monto: totalMontoRecv,
              moneda: 'USD',
              fecha_emision: nowISO().slice(0, 10),
              estado: 'pendiente',
              nota: `Factura cargada por Almacén al recibir requerimiento ${recvFor.code}.${notaGenTrim ? ` Nota: ${notaGenTrim}` : ''}`,
              created_by: uid,
            });
          }
        } catch (cxpErr) {
          console.warn('Sync cxp error:', cxpErr);
        }
      }

      setRecvBusy(false); setRecvFor(null); setRecvRows([]); setRecvNota('');
      refetch();
      toast.success('Recibido en el inventario. Las entradas y la factura quedaron registradas.');
    } catch (e: any) {
      setRecvBusy(false);
      toast.error(e?.message ?? 'No se pudo recibir en inventario.');
    }
  };

  const totalUsdDe = (r: InventoryRequirement) => calcularTotalReqUsd(r.items || [], rate, r.iva_alicuota);

  // Convierte los ítems al formato del PDF, incrustando la imagen de cada producto
  // como data-URI (para que salga SÍ o SÍ en el PDF, sin depender de CORS ni de que
  // la imagen cargue a tiempo al imprimir). En nativo urlToDataUri devuelve null →
  // se usa la URL directa (expo-print sí carga imágenes remotas).
  const itemsToPdf = (r: InventoryRequirement) => Promise.all(r.items.map(async (it) => ({
    name: it.name, unit: it.unit, qty: it.qty, est_price: it.est_price, currency: it.currency,
    isNew: !it.product_id, note: it.note,
    supplier_name: it.supplier_name || null,
    exento: Boolean(it.exento),
    modo_precio: it.modo_precio || 'unidad',
    price_usd: it.price_usd,
    price_bs: it.price_bs,
    total_usd: it.total_usd,
    total_bs: it.total_bs,
    metodo_pago: (it as any).metodo_pago || null,
    cotizaciones_count: Array.isArray(it.cotizaciones) ? it.cotizaciones.length : 0,
    image: it.image_url ? ((await urlToDataUri(it.image_url)) || it.image_url) : null,
  })));

  const buildReqPdfData = async (r: InventoryRequirement): Promise<ReqPdfData> => {
    const selectedSupplier = suppliers.find((s) => s.id === r.supplier_id);
    return {
      code: r.code, fecha: dmyOf(r.created_at), title: r.title, note: r.note,
      company: companyName(r.company_id),
      empresaPagadora: r.empresa_pagadora_nombre ?? null,
      proveedor: selectedSupplier?.name ?? null,
      proveedorDatosPago: selectedSupplier ? {
        banco: selectedSupplier.bank_name,
        cuenta: selectedSupplier.account_number,
        titular: selectedSupplier.account_holder,
        cedulaRif: selectedSupplier.account_id_doc,
        pagoMovil: selectedSupplier.pago_movil_phone ? `${selectedSupplier.pago_movil_bank ?? ''} - ${selectedSupplier.pago_movil_phone} (${selectedSupplier.pago_movil_id ?? ''})` : null,
        binance: selectedSupplier.binance_id,
      } : null,
      requestedBy: r.requested_by_name, responsable: r.responsable_nombre ?? null, statusLabel: REQ_STATUS[r.status]?.short ?? r.status, rate,
      /* 👤 Lo declarado en el papel (20-oct-2026). Lo vacío no sale impreso. */
      solicitante: r.solicitante_nombre ?? null, autorizadoPor: r.autorizado_nombre ?? null,
      destino: destinoLabel(r.destino_tipo), area: r.area ?? null, observaciones: limpiarObservacionesFormatos(r.observaciones) ?? null,
      aclaratoria: r.aclaratoria_motivo ? {
        motivo: r.aclaratoria_motivo,
        solicitadaPor: r.aclaratoria_solicitada_por ?? null,
        fechaSolicitud: r.aclaratoria_fecha_solicitud ? dmyOf(r.aclaratoria_fecha_solicitud) : null,
        respuesta: r.aclaratoria_respuesta ?? null,
        fechaRespuesta: r.aclaratoria_fecha_respuesta ? dmyOf(r.aclaratoria_fecha_respuesta) : null,
      } : null,
      approved: r.status === 'aprobado', decidedBy: r.decided_by_name,
      ivaAlicuota: r.iva_alicuota != null ? Number(r.iva_alicuota) : 16,
      items: await itemsToPdf(r),
    };
  };

  const pdf = async (r: InventoryRequirement) => {
    try {
      await exportPdf(requerimientoHtml(await buildReqPdfData(r)), `Requerimiento ${r.code ?? dmyOf(r.created_at)}`);
    } catch (e: any) { toast.error('No se pudo generar el PDF: ' + (e?.message ?? e)); }
  };

  const rowUsd = (x: ReqRow) => {
    const q = parseNum(x.qty);
    if ((x.modo_precio || 'unidad') === 'total') {
      const tUsd = parseNum(x.total_usd || '0');
      if (tUsd > 0) return tUsd;
    }
    return parseNum(x.price) * q;
  };

  const rowBs = (x: ReqRow) => {
    const q = parseNum(x.qty);
    if ((x.modo_precio || 'unidad') === 'total') {
      const tBs = parseNum(x.total_bs || '0');
      if (tBs > 0) return tBs;
      const tUsd = parseNum(x.total_usd || '0');
      if (tUsd > 0 && rate && rate > 0) return tUsd * rate;
    }
    const pBs = parseNum(x.price_bs);
    if (pBs > 0) return pBs * q;
    const pUsd = parseNum(x.price);
    return rate && rate > 0 ? (pUsd * rate) * q : 0;
  };

  const createSubtotalUsd = rows.reduce((s, x) => s + rowUsd(x), 0);
  const createBaseImponibleUsd = rows.reduce((s, x) => s + (x.exento ? 0 : rowUsd(x)), 0);
  const createExentoUsd = createSubtotalUsd - createBaseImponibleUsd;
  const createAlicuotaNum = Math.min(100, Math.max(0, parseNum(alicuotaIva) || 0));
  const createIvaUsd = Math.round(createBaseImponibleUsd * (createAlicuotaNum / 100) * 100) / 100;
  const createTotalUsd = Math.round((createSubtotalUsd + createIvaUsd) * 100) / 100;

  const createSubtotalBs = rows.reduce((s, x) => s + rowBs(x), 0);
  const createBaseImponibleBs = rows.reduce((s, x) => s + (x.exento ? 0 : rowBs(x)), 0);
  const createExentoBs = createSubtotalBs - createBaseImponibleBs;
  const createIvaBs = Math.round(createBaseImponibleBs * (createAlicuotaNum / 100) * 100) / 100;
  const createTotalBs = Math.round((createSubtotalBs + createIvaBs) * 100) / 100;

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Requerimientos</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
          {isAdmin ? (
            <TouchableOpacity
              onPress={abrirConfigModal}
              style={{
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
                borderWidth: 1,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
                borderRadius: radius.pill,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Text style={{ fontSize: 11 }}>⚙️</Text>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11 }}>
                Límite: ${configAprobacion.montoLimiteUSD.toLocaleString()} USD
              </Text>
            </TouchableOpacity>
          ) : null}
          {canWrite ? (
            <TouchableOpacity onPress={() => { limpiarForm(); setCreateOpen(true); }} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>➕ Nuevo</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Pide productos del inventario o nuevos para que el jefe apruebe la compra. Si se compra, se recibe en el inventario con su precio. {rate ? `Tasa hoy: ${fmtBs(rate)}/US$.` : ''}
      </Text>

      {/* Filtro por estatus */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([
          { k: 'todos', label: 'Todos', color: colors.brandText },
          { k: 'pendiente', label: '⏳ Pendientes', color: '#D97706' },
          { k: 'aclaratoria_solicitada', label: '⚠️ En Aclaratoria', color: '#D97706' },
          { k: 'sin_precio', label: '❗ Sin precio', color: '#DC2626' },
          { k: 'aprobado', label: '✅ Aprobados (Por Pagar)', color: '#2563EB' },
          { k: 'esperando_recepcion', label: '📦 Esperando Recepción', color: '#0D9488' },
          { k: 'rechazado', label: '❌ Rechazados', color: '#DC2626' },
          { k: 'recibido', label: '📦 Recibidos', color: '#16A34A' },
        ] as const).map((f) => {
          const on = filterStatus === f.k;
          const n = f.k === 'todos'
            ? reqs.length
            : f.k === 'sin_precio'
              ? reqs.filter(faltaPrecioDe).length
              : f.k === 'esperando_recepcion'
                ? reqs.filter((r) => {
                  const provG = suppliers.find((s) => s.id === r.supplier_id);
                  return calcularEstadoRequerimiento(r, rate, provG, configAprobacion, cuentasPagadasSet.has(r.id)).codigo === 'esperando_recepcion';
                }).length
                : f.k === 'aprobado'
                  ? reqs.filter((r) => {
                    const provG = suppliers.find((s) => s.id === r.supplier_id);
                    return calcularEstadoRequerimiento(r, rate, provG, configAprobacion, cuentasPagadasSet.has(r.id)).codigo === 'aprobado';
                  }).length
                  : reqs.filter((r) => r.status === f.k).length;
          return (
            <TouchableOpacity key={f.k} onPress={() => setFilterStatus(f.k)} style={{ borderWidth: 1.5, borderColor: f.color, backgroundColor: on ? f.color : 'transparent', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
              <Text style={{ color: on ? '#fff' : f.color, fontWeight: '800', fontSize: 12 }}>{f.label} ({n})</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Búsqueda libre (código, título, nota, solicitante, empresa, ítems) + rango de fecha. */}
      <TextInput
        value={listQuery}
        onChangeText={setListQuery}
        placeholder="🔎 Buscar: código, título, nota, solicitante, empresa, producto…"
        placeholderTextColor={colors.muted}
        style={{ ...inp, marginBottom: spacing.xs }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
          <DateField value={reqDateFrom} onChange={setReqDateFrom} placeholder="Cualquiera" maxISO={reqDateTo || undefined} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
          <DateField value={reqDateTo} onChange={setReqDateTo} placeholder="Cualquiera" minISO={reqDateFrom || undefined} />
        </View>
        {reqDateFrom || reqDateTo ? (
          <TouchableOpacity onPress={() => { setReqDateFrom(''); setReqDateTo(''); }} style={{ alignSelf: 'flex-end', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {(() => {
        const nq = norm(listQuery);
        const filteredReqs = reqs
          .filter((r) => {
            if (filterStatus === 'todos') return true;
            if (filterStatus === 'sin_precio') return faltaPrecioDe(r);
            const provG = suppliers.find((s) => s.id === r.supplier_id);
            const est = calcularEstadoRequerimiento(r, rate, provG, configAprobacion, cuentasPagadasSet.has(r.id));
            if (filterStatus === 'esperando_recepcion') return est.codigo === 'esperando_recepcion';
            if (filterStatus === 'aprobado') return est.codigo === 'aprobado';
            return r.status === filterStatus;
          })
          .filter((r) => !reqDateFrom || r.created_at.slice(0, 10) >= reqDateFrom)
          .filter((r) => !reqDateTo || r.created_at.slice(0, 10) <= reqDateTo)
          .filter((r) => {
            if (!nq) return true;
            const haystack = [r.code, r.title, r.note, r.requested_by_name, r.decided_by_name, companyName(r.company_id), ...r.items.map((it) => it.name)]
              .filter(Boolean).join(' ');
            return norm(haystack).includes(nq);
          });
        const allSel = filteredReqs.length > 0 && filteredReqs.every((r) => reqSelIds.has(r.id));
        const selectedOrFiltered = () => reqSelIds.size ? filteredReqs.filter((r) => reqSelIds.has(r.id)) : filteredReqs;
        const toReqPdfData = (r: (typeof filteredReqs)[number]): Promise<ReqPdfData> => buildReqPdfData(r);
        const pdfMultiple = async () => {
          const base = selectedOrFiltered();
          if (base.length === 0) return;
          try {
            await exportPdf(requerimientosBulkHtml(await Promise.all(base.map(toReqPdfData))), `Requerimientos ${dmyOf(new Date().toISOString())}`);
          } catch (e: any) { toast.error('No se pudo generar el PDF: ' + (e?.message ?? e)); }
        };
        const pdfResumen = async () => {
          const base = selectedOrFiltered();
          if (base.length === 0) return;
          try {
            await exportPdf(requerimientosResumenHtml(await Promise.all(base.map(toReqPdfData))), `Resumen requerimientos ${dmyOf(new Date().toISOString())}`);
          } catch (e: any) { toast.error('No se pudo generar el resumen: ' + (e?.message ?? e)); }
        };
        return filteredReqs.length === 0 ? (
          <EmptyState title="Sin requerimientos" subtitle={filterStatus === 'todos' && !listQuery && !reqDateFrom && !reqDateTo ? 'Crea uno con ➕ Nuevo para pasárselo al jefe.' : 'Ningún requerimiento coincide con el filtro/búsqueda.'} />
        ) : (
          <>
            {/* Selección para el PDF por lote: "Seleccionar todos" marca los VISIBLES (ya
              filtrados/buscados); el botón exporta solo los marcados, o todos los
              filtrados si no hay ninguno marcado. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, flexWrap: 'wrap', gap: spacing.xs }}>
              <TouchableOpacity onPress={() => setReqSelIds(allSel ? new Set() : new Set(filteredReqs.map((r) => r.id)))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: allSel ? colors.brand : colors.border, backgroundColor: allSel ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {allSel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                </View>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todos ({filteredReqs.length})</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <TouchableOpacity onPress={pdfResumen} style={{ backgroundColor: colors.surfaceAlt ?? colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>📄 Resumen{reqSelIds.size ? ` (${reqSelIds.size})` : ` (${filteredReqs.length})`}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={pdfMultiple} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📥 PDF{reqSelIds.size ? ` (${reqSelIds.size})` : ` (${filteredReqs.length})`}</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* APROBACIÓN EN LOTE (solo admin): aparece cuando hay ≥1 requerimiento
              PENDIENTE marcado; aprueba todos los marcados de un solo click. */}
            {isAdmin && (() => {
              const nPend = filteredReqs.filter((r) => reqSelIds.has(r.id) && r.status === 'pendiente').length;
              if (!nPend) return null;
              return (
                <TouchableOpacity onPress={aprobarLote} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.brandContrast ?? '#fff', fontWeight: '900', fontSize: 14 }}>✅ Aprobar en lote ({nPend})</Text>
                </TouchableOpacity>
              );
            })()}
            {filteredReqs.map((r) => {
              const rSel = reqSelIds.has(r.id);
              return (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }}>
                  <TouchableOpacity onPress={() => toggleReqSel(r.id)} style={{ paddingTop: spacing.md }}>
                    <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: rSel ? colors.brand : colors.border, backgroundColor: rSel ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {rSel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                    </View>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    {(() => {
                      const provGeneral = suppliers.find((s) => s.id === r.supplier_id);
                      const estDinamico = calcularEstadoRequerimiento(r, rate, provGeneral, configAprobacion, cuentasPagadasSet.has(r.id));
                      const tUsd = estDinamico.totalUSD;
                      const faltaPrecio = !estDinamico.tieneCotizacionCompleta;
                      return (
                        <ExpandableCard
                          key={r.id}
                          summary={
                            <View>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                                <View style={{ flex: 1, minWidth: 150 }}>
                                  <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{r.code ?? 'REQ'} · {r.title || `${r.items.length} ítem(s)`}</Text>
                                  <Text style={{ color: colors.muted, fontSize: 12 }}>{dmyOf(r.created_at)}{companyName(r.company_id) ? ` · 🏢 ${companyName(r.company_id)}` : ''}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}{r.responsable_nombre ? ` · 📦 Resp.: ${r.responsable_nombre}` : ''}</Text>
                                  {r.empresa_pagadora_nombre ? (
                                    <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700', marginTop: 1 }}>💳 Pagadora: {r.empresa_pagadora_nombre}</Text>
                                  ) : null}
                                </View>
                                <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 1, maxWidth: 260 }}>
                                  {canReceive ? (
                                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setStatusPickerId((id) => (id === r.id ? null : r.id)); }}>
                                      <Pill label={`${estDinamico.label} ${statusPickerId === r.id ? '▴' : '▾'}`} color={estDinamico.color} />
                                    </TouchableOpacity>
                                  ) : (
                                    <Pill label={estDinamico.label} color={estDinamico.color} />
                                  )}
                                  {faltaPrecio ? <Pill label="❗ Pendiente por cargar precio" color={colors.danger} /> : null}
                                </View>
                              </View>

                              {/* Badge de Compra Consolidada Multi-Proveedor */}
                              {estDinamico.esMultiProveedor ? (
                                <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#EFF6FF', borderColor: '#3B82F6', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                                  <Text style={{ color: '#1D4ED8', fontWeight: '800', fontSize: 11 }}>
                                    🏢 Compra Consolidada Multi-Proveedor ({estDinamico.proveedoresNombres.join(', ')})
                                  </Text>
                                </View>
                              ) : null}

                              {/* Filtro de Seguridad por Monto (configurable por monto, empresa y personas) */}
                              {estDinamico.requiereAprobacionGG ? (
                                <View style={{ alignSelf: 'stretch', marginTop: 5, backgroundColor: '#FAF5FF', borderColor: '#8B5CF6', borderWidth: 1.5, borderRadius: radius.md, padding: spacing.sm, gap: 4 }}>
                                  <Text style={{ color: '#6D28D9', fontWeight: '900', fontSize: 12 }}>
                                    👔 Umbral &gt; ${(estDinamico.montoLimiteAplicado || 1000).toLocaleString()} USD ({estDinamico.empresaReglaAplicada || 'Todas'}): Esperando Aprobación de {estDinamico.aprobadoresNombres || 'Gerente General'}
                                  </Text>
                                  <Text style={{ color: '#7C3AED', fontSize: 11 }}>
                                    Monto total: {usd(tUsd)}. Exige revisión y aprobación obligatoria de {estDinamico.aprobadoresNombres || 'Gerente General'} antes de proceder al pago.
                                  </Text>
                                  {isAdmin && (
                                    <TouchableOpacity
                                      onPress={() => aprobarGerenteGeneral(r)}
                                      style={{
                                        marginTop: 3,
                                        backgroundColor: '#7C3AED',
                                        paddingVertical: 7,
                                        paddingHorizontal: 12,
                                        borderRadius: radius.md,
                                        alignSelf: 'flex-start',
                                      }}
                                    >
                                      <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11.5 }}>
                                        ✓ Aprobar ({estDinamico.aprobadoresNombres || 'Gerente General'}) (&gt; ${(estDinamico.montoLimiteAplicado || 1000).toLocaleString()} USD)
                                      </Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              ) : tUsd >= (estDinamico.montoLimiteAplicado || 1000) && r.gerente_aprobado ? (
                                <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#ECFDF5', borderColor: '#10B981', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                                  <Text style={{ color: '#047857', fontWeight: '800', fontSize: 11 }}>✓ Aprobado por {r.gerente_aprobado_por || estDinamico.aprobadoresNombres || 'Gerente'}</Text>
                                </View>
                              ) : null}

                              {(() => {
                                const condReq = extraerCondicionesPago(r.observaciones);
                                if (!condReq) return null;
                                return (
                                  <View style={{ marginTop: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderLeftWidth: 3, borderLeftColor: colors.brand }}>
                                    <Text style={{ color: colors.text, fontSize: 11.5 }}>
                                      <Text style={{ color: colors.infoSoftText, fontWeight: '800' }}>💳 Condiciones de pago: </Text>
                                      <Text style={{ fontWeight: '700' }}>{condReq}</Text>
                                    </Text>
                                  </View>
                                );
                              })()}

                              {r.status === 'aclaratoria_solicitada' && r.aclaratoria_motivo ? (
                                <View style={{ backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs }}>
                                  <Text style={{ color: '#92400E', fontWeight: '800', fontSize: 12 }}>⚠️ Aclaratoria Técnica Solicitada por Compras</Text>
                                  <Text style={{ color: '#B45309', fontSize: 12, marginTop: 2 }}>{r.aclaratoria_motivo}</Text>
                                  {r.aclaratoria_solicitada_por ? (
                                    <Text style={{ color: '#92400E', fontSize: 10, marginTop: 2 }}>Solicitado por: {r.aclaratoria_solicitada_por}{r.aclaratoria_fecha_solicitud ? ` (${dmyOf(r.aclaratoria_fecha_solicitud)})` : ''}</Text>
                                  ) : null}
                                </View>
                              ) : null}

                              {r.aclaratoria_respuesta ? (
                                <View style={{ backgroundColor: '#ECFDF5', borderColor: '#10B981', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs }}>
                                  <Text style={{ color: '#065F46', fontWeight: '800', fontSize: 12 }}>💬 Respuesta Técnica Registrada</Text>
                                  <Text style={{ color: '#047857', fontSize: 12, marginTop: 2 }}>{r.aclaratoria_respuesta}</Text>
                                  {r.aclaratoria_fecha_respuesta ? (
                                    <Text style={{ color: '#065F46', fontSize: 10, marginTop: 2 }}>Respondido: {dmyOf(r.aclaratoria_fecha_respuesta)}</Text>
                                  ) : null}
                                </View>
                              ) : null}

                              {/* Cambiar estado A MANO, tocando el badge de arriba — no crea ni revierte
                    stock, solo corrige la etiqueta. Aparte del pill "sin precio". */}
                              {canReceive && statusPickerId === r.id ? (
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: spacing.xs, justifyContent: 'flex-end' }}>
                                  <Text style={{ color: colors.muted, fontSize: 11 }}>Cambiar a:</Text>
                                  {(['pendiente', 'aclaratoria_solicitada', 'aprobado', 'esperando_recepcion', 'rechazado', 'recibido'] as const).filter((s) => s !== r.status).map((s) => (
                                    <TouchableOpacity key={s} onPress={(e) => { e.stopPropagation?.(); cambiarEstadoManual(r, s); }} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>{REQ_STATUS[s]?.short || s}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          }
                          detail={
                            <View>
                              {r.items.map((it, i) => {
                                const q = Number(it.qty) || 1;
                                const pUsdVal = it.price_usd != null ? it.price_usd : (it.currency === 'USD' ? Number(it.est_price) || 0 : usdFromBs(Number(it.est_price) || 0, rate || 0));
                                const pBsVal = it.price_bs != null ? it.price_bs : (it.currency === 'VES' ? Number(it.est_price) || 0 : (rate && rate > 0 ? Math.round(pUsdVal * rate * 100) / 100 : 0));
                                const totUsdVal = it.modo_precio === 'total' && Number(it.total_usd) > 0 ? Number(it.total_usd) : pUsdVal * q;
                                const totBsVal = it.modo_precio === 'total' && Number(it.total_bs) > 0 ? Number(it.total_bs) : pBsVal * q;
                                const cots = Array.isArray(it.cotizaciones) ? it.cotizaciones : [];
                                return (
                                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                                    <View style={{ flex: 1 }}>
                                      {/* 🔢 Número de renglón */}
                                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                                        <Text style={{ color: colors.muted }}>{i + 1}. </Text>{it.name} {it.product_id ? '' : <Text style={{ color: colors.success, fontSize: 11 }}>· NUEVO</Text>}
                                        {it.exento ? <Text style={{ color: '#0284C7', fontSize: 11, fontWeight: '800' }}> · 🛡️ EXENTO DE IVA</Text> : null}
                                      </Text>
                                      {it.note ? <Text style={{ color: colors.brandText, fontSize: 11, fontStyle: 'italic', marginTop: 1 }}>📐 {it.note}</Text> : null}
                                      {it.supplier_name ? (
                                        <Text style={{ color: '#2563EB', fontSize: 11, fontWeight: '700', marginTop: 1 }}>🏢 Proveedor del ítem: {it.supplier_name}</Text>
                                      ) : null}
                                      {cots.length > 0 ? (
                                        <Text style={{ color: '#7E22CE', fontSize: 11, fontWeight: '700', marginTop: 1 }}>📋 {cots.length} presupuesto(s) alternativo(s) evaluado(s)</Text>
                                      ) : null}
                                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>
                                        {qtyFmt(it.qty)} {it.unit || ''} · {usd(pUsdVal)}{pBsVal > 0 ? ` / ${fmtBs(pBsVal)}` : ''} c/u
                                        {q !== 1 || it.modo_precio === 'total'
                                          ? `  ➜  Total: ${usd(totUsdVal)}${totBsVal > 0 ? ` / ${fmtBs(totBsVal)}` : ''}${it.modo_precio === 'total' ? ' (📦 Precio Total)' : ''}`
                                          : ''}
                                      </Text>
                                    </View>
                                    {it.image_url ? <Image source={{ uri: it.image_url }} style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} /> : null}
                                  </View>
                                );
                              })}
                              {(() => {
                                const lineTotalUsd = (it: RequirementLine) => {
                                  if (it.modo_precio === 'total' && Number(it.total_usd) > 0) return Number(it.total_usd);
                                  const pU = it.price_usd != null ? Number(it.price_usd) : (it.currency === 'USD' ? Number(it.est_price) || 0 : usdFromBs(Number(it.est_price) || 0, rate || 0));
                                  return pU * (Number(it.qty) || 0);
                                };
                                const subUsd = r.items.reduce((s, it) => s + lineTotalUsd(it), 0);
                                const baseUsd = r.items.reduce((s, it) => s + (it.exento ? 0 : lineTotalUsd(it)), 0);
                                const exentoUsd = subUsd - baseUsd;
                                const alic = r.iva_alicuota != null ? Number(r.iva_alicuota) : 0;
                                const ivaUsd = Math.round(baseUsd * (alic / 100) * 100) / 100;
                                const totalConIvaUsd = alic > 0 ? Math.round((subUsd + ivaUsd) * 100) / 100 : tUsd;

                                return (
                                  <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                                    {alic > 0 || exentoUsd > 0 ? (
                                      <View style={{ marginBottom: 4, gap: 2 }}>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                          <Text style={{ color: colors.muted, fontSize: 11 }}>Subtotal:</Text>
                                          <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>{usd(subUsd)}</Text>
                                        </View>
                                        {exentoUsd > 0 ? (
                                          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                            <Text style={{ color: '#0369A1', fontSize: 11 }}>Exento de IVA:</Text>
                                            <Text style={{ color: '#0369A1', fontSize: 11, fontWeight: '700' }}>{usd(exentoUsd)}</Text>
                                          </View>
                                        ) : null}
                                        {alic > 0 ? (
                                          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                            <Text style={{ color: colors.muted, fontSize: 11 }}>IVA ({alic}%):</Text>
                                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>{usd(ivaUsd)}</Text>
                                          </View>
                                        ) : null}
                                      </View>
                                    ) : null}
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                      <Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL ESTIMADO</Text>
                                      <Text style={{ color: colors.brandText, fontWeight: '900' }}>
                                        {usd(totalConIvaUsd)}{rate ? ` · ${fmtBs(bsFromUsd(totalConIvaUsd, rate))}` : ''}
                                      </Text>
                                    </View>
                                  </View>
                                );
                              })()}
                              {r.status === 'aprobado' && r.decided_by_name ? <Text style={{ color: colors.infoSoftText, fontSize: 11, marginTop: 2 }}>Aprobado por {r.decided_by_name}</Text> : null}
                              {r.status === 'rechazado' && r.decided_by_name ? <Text style={{ color: colors.danger, fontSize: 11, marginTop: 2 }}>Rechazado por {r.decided_by_name}</Text> : null}
                              {(() => {
                                const fmts = extraerFormatosAdjuntos(r);
                                if (fmts.length === 0) return null;
                                return (
                                  <Text style={{ color: colors.brandText, fontSize: 11, marginTop: 2, fontWeight: '700' }}>
                                    📎 {fmts.length === 1 ? `Formato adjunto (${fmts[0].kind === 'pdf' ? 'PDF' : 'imagen'})` : `${fmts.length} formatos adjuntos`}
                                  </Text>
                                );
                              })()}

                              {/* 🏬 Ficha de Proveedor Propuesto por el Solicitante (si existe) */}
                              {(() => {
                                const provSug = extraerProveedorSugerido(r.observaciones);
                                if (!provSug) return null;
                                return (
                                  <View
                                    style={{
                                      marginTop: spacing.xs,
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
                                        {provSug.telefono ? (
                                          <>
                                            <TouchableOpacity
                                              onPress={() => Linking.openURL(`tel:${provSug.telefono.replace(/\s+/g, '')}`)}
                                              style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#D97706', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm }}
                                            >
                                              <Text style={{ color: '#B45309', fontSize: 11, fontWeight: '800' }}>📞 Llamar</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                              onPress={() => {
                                                const clean = provSug.telefono.replace(/\D/g, '');
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

                                    {provSug.nombre ? (
                                      <Text style={{ color: '#78350F', fontSize: 12.5 }}>
                                        🏢 <Text style={{ fontWeight: '800' }}>Nombre / Tienda:</Text> {provSug.nombre}
                                      </Text>
                                    ) : null}
                                    {provSug.telefono ? (
                                      <Text style={{ color: '#78350F', fontSize: 12 }}>
                                        📞 <Text style={{ fontWeight: '800' }}>Teléfono:</Text> {provSug.telefono}
                                      </Text>
                                    ) : null}
                                    {provSug.direccion ? (
                                      <Text style={{ color: '#78350F', fontSize: 12 }}>
                                        📍 <Text style={{ fontWeight: '800' }}>Dirección / Ubicación:</Text> {provSug.direccion}
                                      </Text>
                                    ) : null}
                                  </View>
                                );
                              })()}

                              {r.supplier_id ? (() => {
                                const s = suppliers.find((sup) => sup.id === r.supplier_id);
                                if (!s) return null;
                                const hasBank = !!(s.bank_name || s.account_number);
                                const hasPm = !!s.pago_movil_phone;
                                const hasBin = !!s.binance_id;
                                return (
                                  <View style={{ marginTop: spacing.xs, padding: spacing.xs, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text }}>Proveedor General: {s.name}</Text>
                                    {hasBank || hasPm || hasBin || !!extraerCapturaPago(s) ? (
                                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 2 }}>
                                        {hasBank ? <Text style={{ fontSize: 10, color: colors.muted }}>🏦 {s.bank_name} ({s.account_number?.slice(-4) || '—'})</Text> : null}
                                        {hasPm ? <Text style={{ fontSize: 10, color: colors.muted }}>📱 PM: {s.pago_movil_phone}</Text> : null}
                                        {hasBin ? <Text {...rawCaseField} style={{ fontSize: 10, color: colors.muted, textTransform: 'none' }}>🟡 Binance: {s.binance_id}</Text> : null}
                                        {(() => {
                                          const cap = extraerCapturaPago(s);
                                          if (!cap) return null;
                                          return (
                                            <TouchableOpacity
                                              onPress={() => setVisorCapturaProv(cap)}
                                              style={{ backgroundColor: '#581C87', borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 }}
                                            >
                                              <Text style={{ color: '#E9D5FF', fontSize: 10, fontWeight: '800' }}>
                                                📸 {cap.name || 'Captura TRX/Tron'} 👁️
                                              </Text>
                                            </TouchableOpacity>
                                          );
                                        })()}
                                      </View>
                                    ) : (
                                      <Text style={{ fontSize: 10, color: '#D97706' }}>⚠️ Proveedor sin datos bancarios ni de pago móvil registrados</Text>
                                    )}
                                  </View>
                                );
                              })() : null}

                              {/* 🧾 Sección Dedicada: Factura Fiscal / Comercial (Ilusiones / Golden) */}
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

                              {/* 💳 Sección Dedicada: Recibo / Comprobante de Pago Bancario (Expediente Unificado) */}
                              {(() => {
                                const rec = extraerReciboPago(r);
                                const tieneRec = Boolean(rec && (rec.url || rec.referencia));
                                const marcadoPagado = tieneRec || cuentasPagadasSet.has(r.id) || r.status === 'esperando_recepcion' || (r.status as string) === 'pagado';
                                return (
                                  <View
                                    style={{
                                      marginTop: spacing.xs,
                                      backgroundColor: colors.surfaceAlt,
                                      borderRadius: radius.md,
                                      borderWidth: 1.5,
                                      borderColor: marcadoPagado ? '#10B981' : colors.border,
                                      padding: spacing.sm,
                                      gap: 6,
                                    }}
                                  >
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                        <Text style={{ fontSize: 14 }}>💳</Text>
                                        <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.text }}>
                                          Recibo / Comprobante de Pago Bancario
                                        </Text>
                                      </View>
                                      {tieneRec && rec?.metodo ? (
                                        <View
                                          style={{
                                            backgroundColor: '#ECFDF5',
                                            borderColor: '#10B981',
                                            borderWidth: 1,
                                            paddingHorizontal: 8,
                                            paddingVertical: 2,
                                            borderRadius: radius.pill,
                                          }}
                                        >
                                          <Text style={{ color: '#065F46', fontSize: 10.5, fontWeight: '800' }}>
                                            {rec.metodo}
                                          </Text>
                                        </View>
                                      ) : null}
                                    </View>

                                    {marcadoPagado ? (
                                      <View style={{ gap: 4 }}>
                                        {tieneRec ? (
                                          <>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                                              {rec?.referencia ? (
                                                <Text style={{ fontSize: 12, color: colors.text }}>
                                                  <Text style={{ fontWeight: '700' }}>Ref / Comprobante:</Text>{' '}
                                                  <Text style={{ fontWeight: '900', color: '#059669' }}>{rec.referencia}</Text>
                                                </Text>
                                              ) : null}
                                              {rec?.fecha ? (
                                                <Text style={{ fontSize: 11.5, color: colors.muted }}>
                                                  📅 Fecha de Pago: {rec.fecha}
                                                </Text>
                                              ) : null}
                                            </View>
                                            {rec?.subidoPor ? (
                                              <Text style={{ fontSize: 11, color: colors.muted }}>
                                                👤 Adjuntado por: {rec.subidoPor}
                                              </Text>
                                            ) : null}
                                          </>
                                        ) : (
                                          <Text style={{ fontSize: 11.5, color: '#047857', fontWeight: '700' }}>
                                            ✅ Marcado como pagado (sincronizado con Cuentas por Pagar).
                                          </Text>
                                        )}
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                                          {rec?.url ? (
                                            <TouchableOpacity
                                              onPress={() => abrirVisorFactura(rec.url!, rec.tipo, rec.nombre || 'Recibo de Pago')}
                                              style={{
                                                backgroundColor: colors.surface,
                                                borderWidth: 1,
                                                borderColor: '#10B981',
                                                borderRadius: radius.sm,
                                                paddingHorizontal: spacing.sm,
                                                paddingVertical: 4,
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                gap: 4,
                                              }}
                                            >
                                              <Text style={{ fontSize: 11 }}>👁️</Text>
                                              <Text style={{ color: '#047857', fontWeight: '700', fontSize: 11.5 }}>
                                                Ver Recibo Adjunto
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
                                                ✏️ Modificar Recibo
                                              </Text>
                                            </TouchableOpacity>
                                          ) : null}
                                          {canWrite ? (
                                            <TouchableOpacity
                                              onPress={() => revertirPagoRequerimiento(r)}
                                              style={{
                                                backgroundColor: colors.surface,
                                                borderWidth: 1,
                                                borderColor: colors.danger,
                                                borderRadius: radius.sm,
                                                paddingHorizontal: spacing.sm,
                                                paddingVertical: 4,
                                              }}
                                            >
                                              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11.5 }}>
                                                ↩ Revertir Pago (Volver a Por Pagar)
                                              </Text>
                                            </TouchableOpacity>
                                          ) : null}
                                        </View>
                                      </View>
                                    ) : (
                                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                        <Text style={{ fontSize: 11.5, color: colors.muted, fontStyle: 'italic', flex: 1 }}>
                                          Sin comprobante de pago cargado aún.
                                        </Text>
                                        {canWrite ? (
                                          <TouchableOpacity
                                            onPress={() => abrirSubirFactura(r)}
                                            style={{
                                              backgroundColor: '#10B981',
                                              borderRadius: radius.sm,
                                              paddingHorizontal: spacing.sm,
                                              paddingVertical: 5,
                                              flexDirection: 'row',
                                              alignItems: 'center',
                                              gap: 4,
                                            }}
                                          >
                                            <Text style={{ fontSize: 12 }}>💳</Text>
                                            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11.5 }}>
                                              Subir Recibo de Pago
                                            </Text>
                                          </TouchableOpacity>
                                        ) : null}
                                      </View>
                                    )}
                                  </View>
                                );
                              })()}

                              {/* 📦 Sección Dedicada: Control Físico de Almacén (Disponible vs Retirado) */}
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
                                              🕒 Fecha: {dmyOf(desp.fecha)}
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
                                        {canReceive ? (
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
                                        {canReceive ? (
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

                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                                <TouchableOpacity onPress={() => pdf(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🧾 PDF</Text>
                                </TouchableOpacity>
                                {/* Botón de Cotizaciones Múltiples y Multi-Moneda */}
                                <TouchableOpacity
                                  onPress={() => abrirCotizaciones(r)}
                                  style={{
                                    backgroundColor: '#0EA5E9',
                                    borderRadius: radius.md,
                                    paddingHorizontal: spacing.md,
                                    paddingVertical: spacing.xs,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  <Text style={{ fontSize: 12 }}>📋</Text>
                                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                                    Cotizaciones ({getReqCotizaciones(r).length})
                                  </Text>
                                </TouchableOpacity>
                                {/* Botón de Expediente Completo Oficial (PDF) */}
                                <TouchableOpacity
                                  onPress={() => descargarExpediente(r)}
                                  style={{
                                    backgroundColor: '#1E3A5F',
                                    borderRadius: radius.md,
                                    paddingHorizontal: spacing.md,
                                    paddingVertical: spacing.xs,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 5,
                                  }}
                                >
                                  <Text style={{ fontSize: 12 }}>📑</Text>
                                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                                    Expediente Completo (PDF)
                                  </Text>
                                </TouchableOpacity>
                                {/* Subir formato (imagen o PDF) al requerimiento. */}
                                {canWrite ? (
                                  <TouchableOpacity onPress={() => subirFormato(r)} disabled={subiendoId === r.id} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: subiendoId === r.id ? 0.6 : 1 }}>
                                    <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>
                                      {subiendoId === r.id ? '⏳ Subiendo…' : (() => {
                                        const fmts = extraerFormatosAdjuntos(r);
                                        return fmts.length > 0 ? `📎 Adjuntar otro (${fmts.length})` : '📎 Subir formato';
                                      })()}
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}
                                {/* Ver formatos adjuntos (vista previa + descarga). */}
                                {(() => {
                                  const fmts = extraerFormatosAdjuntos(r);
                                  if (fmts.length === 0) return null;
                                  return (
                                    <TouchableOpacity onPress={() => { setPreviewReq(r); setPreviewIndex(0); }} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                                        👁️ Ver formatos ({fmts.length})
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })()}
                                {/* Solicitar aclaratoria técnica si está pendiente */}
                                {canWrite && r.status === 'pendiente' ? (
                                  <TouchableOpacity onPress={() => abrirSolicitarAclaratoria(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: '#F59E0B', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: '#D97706', fontWeight: '800', fontSize: 12 }}>🔄 Solicitar Aclaratoria</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {/* Responder aclaratoria técnica si está en aclaratoria */}
                                {r.status === 'aclaratoria_solicitada' ? (
                                  <TouchableOpacity onPress={() => abrirResponderAclaratoria(r)} style={{ backgroundColor: '#F59E0B', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>📝 Responder Aclaratoria</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {/* Editar datos de pago del proveedor si tiene proveedor asignado */}
                                {r.supplier_id && canWrite ? (() => {
                                  const s = suppliers.find((sup) => sup.id === r.supplier_id);
                                  if (!s) return null;
                                  return (
                                    <TouchableOpacity onPress={() => abrirEditarPagoProv(s)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>💳 Datos de Pago Prov.</Text>
                                    </TouchableOpacity>
                                  );
                                })() : null}
                                {/* Botón de aprobación Gerente General si supera los $1,000 USD */}
                                {isAdmin && estDinamico.requiereAprobacionGG ? (
                                  <TouchableOpacity onPress={() => aprobarGerenteGeneral(r)} style={{ backgroundColor: '#7C3AED', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>👔 Aprobar GG (&gt; $1k)</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {isAdmin && r.status === 'pendiente' ? (
                                  <>
                                    <TouchableOpacity onPress={() => decidir(r, 'aprobado')} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>✅ Aprobar</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => decidir(r, 'rechazado')} style={{ backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>❌ Rechazar</Text>
                                    </TouchableOpacity>
                                  </>
                                ) : null}
                                {canReceive && (r.status === 'aprobado' || estDinamico.codigo === 'esperando_recepcion' || (r.status as string) === 'esperando_recepcion') ? (
                                  <TouchableOpacity onPress={() => abrirRecibir(r)} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📥 Recibir en inventario</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {/* Anular un requerimiento YA APROBADO: el mismo gerente lo rechaza y la
                      BD anula la orden de compra + cuenta por pagar generadas. */}
                                {isAdmin && (r.status === 'aprobado' || estDinamico.codigo === 'esperando_recepcion' || (r.status as string) === 'esperando_recepcion') ? (
                                  <TouchableOpacity onPress={() => anularAprobado(r)} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>⛔ Anular (rechazar)</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {/* Revertir un rechazo (error de dedo) → vuelve a PENDIENTE y notifica. */}
                                {isAdmin && r.status === 'rechazado' ? (
                                  <TouchableOpacity onPress={() => revertirRechazo(r)} style={{ backgroundColor: colors.warning, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>↩ Volver a pendiente</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {/* Editar todo el requerimiento (no si ya se recibió en inventario). */}
                                {canWrite && r.status !== 'recibido' ? (
                                  <TouchableOpacity onPress={() => abrirEditar(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>✏️ Editar</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {/* Eliminar todo el requerimiento. */}
                                {canWrite ? (
                                  <TouchableOpacity onPress={() => eliminar(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Eliminar</Text>
                                  </TouchableOpacity>
                                ) : null}
                                {!isAdmin && r.status === 'pendiente' ? <Text style={{ color: colors.muted, fontSize: 11, alignSelf: 'center' }}>Esperando aprobación del jefe…</Text> : null}
                                {r.status === 'aclaratoria_solicitada' ? <Text style={{ color: '#B45309', fontSize: 11, alignSelf: 'center', fontWeight: '700' }}>⚠️ Esperando respuesta técnica para reanudar aprobación</Text> : null}
                              </View>
                            </View>
                          }
                        />
                      );
                    })()}
                  </View>
                </View>
              );
            })}
          </>
        );
      })()}

      {/* ── Crear requerimiento ── */}
      <Modal visible={createOpen} animationType="slide" onRequestClose={() => { setCreateOpen(false); limpiarForm(); }}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editId ? 'Editar requerimiento' : 'Nuevo requerimiento'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Título (opcional)</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="EJ. REPUESTOS EXCAVADORA 320" placeholderTextColor={colors.muted} style={inp} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Nota / justificación (opcional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="Para qué se necesita…" placeholderTextColor={colors.muted} multiline style={[inp, { minHeight: 60, textAlignVertical: 'top' }]} />

              {/* Empresa para la que se hace el requerimiento (opcional). */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Empresa (opcional)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[{ id: null as string | null, name: 'Sin empresa' }, ...companies].map((c) => {
                  const on = companyId === c.id;
                  return (
                    <TouchableOpacity key={c.id ?? '__none__'} onPress={() => setCompanyId(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Proveedor (opcional): al asignarlo y APROBAR, la orden pasa a
                  "aprobada" y se genera la CUENTA POR PAGAR (trigger req_sync_compra).
                  Sin proveedor la orden queda en BORRADOR. Los proveedores se crean
                  en la pestaña "Proveedores" de Compras. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Proveedor (opcional)</Text>
              {/* Selector buscable: muestra el proveedor elegido; al tocarlo abre
                  un buscador con la lista filtrada (hay muchos proveedores). */}
              <TouchableOpacity onPress={() => setSupOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: supplierId ? colors.brand : colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                <Text style={{ color: supplierId ? colors.text : colors.muted, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                  {supplierId ? (suppliers.find((s) => s.id === supplierId)?.name ?? '—') : 'Sin proveedor'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{supOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {supOpen ? (
                <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                  <TextInput value={supQ} onChangeText={setSupQ} placeholder="Buscar proveedor…" placeholderTextColor={colors.muted} style={[inp, { margin: 6 }]} />
                  <View style={{ maxHeight: 200 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      {[{ id: null as string | null, name: 'Sin proveedor' }, ...suppliers.filter((s) => !supQ.trim() || norm(s.name).includes(norm(supQ)))].map((s) => {
                        const on = supplierId === s.id;
                        return (
                          <TouchableOpacity key={s.id ?? '__none__'} onPress={() => { setSupplierId(s.id); setSupOpen(false); setSupQ(''); }} style={{ paddingVertical: 9, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.brand : 'transparent' }}>
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{s.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {suppliers.filter((s) => !supQ.trim() || norm(s.name).includes(norm(supQ))).length === 0 ? (
                        <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.md }}>Sin coincidencias.</Text>
                      ) : null}
                    </ScrollView>
                  </View>
                </View>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>Al asignar proveedor y aprobar, se generan la orden de compra y la cuenta por pagar automáticamente.</Text>

              {/* Coordenadas financieras del proveedor seleccionado */}
              {supplierId ? (() => {
                const s = suppliers.find((sup) => sup.id === supplierId);
                if (!s) return null;
                const hasBank = !!(s.bank_name || s.account_number);
                const hasPm = !!s.pago_movil_phone;
                const hasBin = !!s.binance_id;
                return (
                  <View style={{ marginTop: 6, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>💳 Datos de Pago del Proveedor</Text>
                      <TouchableOpacity onPress={() => abrirEditarPagoProv(s)}>
                        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11 }}>✏️ {hasBank || hasPm || hasBin ? 'Actualizar datos' : 'Registrar datos'}</Text>
                      </TouchableOpacity>
                    </View>
                    {hasBank || hasPm || hasBin || !!extraerCapturaPago(s) ? (
                      <View style={{ marginTop: 4, gap: 2 }}>
                        {hasBank ? <Text style={{ fontSize: 11, color: colors.muted }}>🏦 {s.bank_name} · Cta: {s.account_number ? `...${s.account_number.slice(-4)}` : '—'} · {s.account_holder} ({s.account_id_doc})</Text> : null}
                        {hasPm ? <Text style={{ fontSize: 11, color: colors.muted }}>📱 PM: {s.pago_movil_phone} · {s.pago_movil_bank ?? '—'} · {s.pago_movil_id ?? '—'}</Text> : null}
                        {hasBin ? <Text {...rawCaseField} style={{ fontSize: 11, color: colors.muted, textTransform: 'none' }}>🟡 Binance Pay ID: {s.binance_id}</Text> : null}
                        {(() => {
                          const cap = extraerCapturaPago(s);
                          if (!cap) return null;
                          return (
                            <TouchableOpacity
                              onPress={() => setVisorCapturaProv(cap)}
                              style={{ alignSelf: 'flex-start', backgroundColor: '#581C87', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 }}
                            >
                              <Text style={{ color: '#E9D5FF', fontSize: 10.5, fontWeight: '800' }}>
                                📸 {cap.name || 'Captura de Billetera TRX / Tron / QR'} 👁️ Ver grande
                              </Text>
                            </TouchableOpacity>
                          );
                        })()}
                      </View>
                    ) : (
                      <Text style={{ fontSize: 11, color: '#D97706', marginTop: 2 }}>⚠️ Sin coordenadas financieras registradas. Toca "Registrar datos" para agilizar el envío a Tesorería.</Text>
                    )}
                  </View>
                );
              })() : null}

              {/* 🏢 Empresa Pagadora (Tesorería / Desembolso) */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Empresa Pagadora (Tesorería)</Text>
              <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 4 }}>Entidad que realizará el desembolso financiero (ej. Construcciones Liscioni, C.A. vs Golden Touch 1127, C.A.).</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[{ id: null as string | null, name: 'Por definir / Sin asignar' }, ...companies].map((c) => {
                  const on = empresaPagadoraId === c.id;
                  return (
                    <TouchableOpacity key={c.id ?? '__pagadora_none__'} onPress={() => { setEmpresaPagadoraId(c.id); setEmpresaPagadoraNombre(c.id ? c.name : null); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* 👤 RESPONSABLE: elegible entre los del rol ALMACENISTA; al elegido le
                  llega un aviso a su campana. Quien lo crea sale solo. Es opcional, pero
                  el rótulo NO lo dice (pedido textual, 17-oct-2026). */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Responsable</Text>
              <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 4 }}>✍️ Quien lo crea sale solo. El responsable se elige entre los almacenistas, y le llega un aviso con este requerimiento.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[{ id: null as string | null, name: 'Sin responsable' }, ...almacenistas].map((a) => {
                  const on = respId === a.id;
                  return (
                    <TouchableOpacity key={a.id ?? '__none__'} onPress={() => { setRespId(a.id); setRespNombre(a.id ? a.name : null); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{a.id ? `📦 ${a.name}` : a.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {almacenistas.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>No hay usuarios con rol de almacenista todavía (se asigna en Usuarios).</Text>
                ) : null}
              </View>

              {/* 👤 QUIÉN LO SOLICITÓ Y QUIÉN LO AUTORIZÓ (20-oct-2026, a pedido).
                  Salen de la NÓMINA —que acá solo se lee— y, si la persona no está,
                  se escribe y queda en Contactos. No se confunden con «Solicita»
                  (el usuario que registra) ni con quien aprueba en el sistema. */}
              <PersonaNominaPicker
                titulo="Solicitado por"
                ayuda="👥 De la lista de la nómina. Si la persona no está, escribe su nombre y queda en Contactos."
                icono="👤"
                valor={solicitante}
                onElegir={setSolicitante}
                personas={personas}
                contactos={contactosLista}
                onGuardarContacto={guardarContacto}
                cargando={cargandoNomina}
              />
              <PersonaNominaPicker
                titulo="Autorizado por"
                ayuda="✅ Quién autorizó la compra. La aprobación dentro del sistema la sigue dando el jefe."
                icono="✅"
                valor={autorizado}
                onElegir={setAutorizado}
                personas={personas}
                contactos={contactosLista}
                onGuardarContacto={guardarContacto}
                cargando={cargandoNomina}
              />

              {/* 🚜 ¿Para qué es? Vehículo o maquinaria. Se puede dejar sin elegir. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>¿Para qué es?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[{ key: null as string | null, chip: 'Sin especificar' }, ...DESTINOS].map((d) => {
                  const on = destino === d.key;
                  return (
                    <TouchableOpacity key={d.key ?? '__none__'} onPress={() => setDestino(d.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{d.chip}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* 🏢 Área a la que va dirigido. La lista sale de las áreas que YA
                  existen (nómina + requerimientos anteriores); si falta una, se
                  escribe con «✏️ Otra» — sin catálogo nuevo que mantener. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Área a la que va dirigido</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <TouchableOpacity onPress={() => { setArea(''); setAreaLibre(false); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: !area && !areaLibre ? colors.brand : colors.border, backgroundColor: !area && !areaLibre ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: !area && !areaLibre ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>Sin área</Text>
                </TouchableOpacity>
                {areas.map((a) => {
                  const on = !areaLibre && area === a;
                  return (
                    <TouchableOpacity key={a} onPress={() => { setArea(a); setAreaLibre(false); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🏢 {a}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity onPress={() => { setAreaLibre(true); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: areaLibre ? colors.brand : colors.border, backgroundColor: areaLibre ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: areaLibre ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>✏️ Otra</Text>
                </TouchableOpacity>
              </View>
              {areaLibre ? (
                <TextInput value={area} onChangeText={setArea} placeholder="Escribe el área (ej. ADMINISTRACIÓN)" placeholderTextColor={colors.muted} autoCapitalize="characters" style={[inp, { marginTop: 6 }]} />
              ) : null}
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setPickOpen((v) => !v)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>📦 Del inventario</Text></TouchableOpacity>
              <TouchableOpacity onPress={addBlank} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>＋ Producto nuevo</Text></TouchableOpacity>
            </View>

            {pickOpen ? (
              <Card>
                <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto por nombre o SKU…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />
                <View style={{ maxHeight: 200 }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {productos.map((it) => (
                      <TouchableOpacity key={it.id} onPress={() => addFromProduct(it)} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{it.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{it.sku ? `${it.sku} · ` : ''}Stock {qtyFmt(it.stock)} · PMP {usd(it.avg_cost)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </Card>
            ) : null}

            {rows.map((x, i) => {
              const otra = x.currency === 'USD' ? fmtBs(bsFromUsd(parseNum(x.price), rate || 0)) : usd(usdFromBs(parseNum(x.price), rate || 0));
              return (
                <Card key={x.key}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      {/* 🔢 Número del renglón (16-oct-2026, a pedido: «que me los vaya
                          enumerando»). Va por POSICIÓN, así que al quitar uno del medio
                          los de abajo se recorren solos y nunca queda un hueco. Es el
                          MISMO número que sale en la columna «#» del PDF. */}
                      <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>{i + 1}</Text>
                      </View>
                      <Text style={{ color: x.product_id ? colors.muted : colors.success, fontSize: 11, fontWeight: '700' }}>{x.product_id ? 'Del inventario' : 'Producto NUEVO'}</Text>
                    </View>
                    <TouchableOpacity onPress={() => rm(x.key)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑 Quitar</Text></TouchableOpacity>
                  </View>
                  <TextInput value={x.name} onChangeText={(t) => upd(x.key, 'name', t)} editable={!x.product_id} placeholder="Nombre del producto o repuesto" placeholderTextColor={colors.muted} style={[inp, x.product_id ? { color: colors.muted } : null]} />
                  <TextInput
                    value={x.note || ''}
                    onChangeText={(t) => upd(x.key, 'note', t)}
                    placeholder="Medidas, especificaciones técnicas o N° de parte (ej. 50mm, rosca 1/2, CAT 320D)…"
                    placeholderTextColor={colors.muted}
                    style={[inp, { marginTop: 4, fontSize: 12 }]}
                  />
                  {/* 🎯 Selector: Precio por Unidad (c/u) vs Precio Total por el o los objetos */}
                  {(() => {
                    const modoRow = x.modo_precio || 'unidad';
                    const qNum = parseNum(x.qty) || 1;
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '700' }}>
                          💰 ¿Cómo deseas colocar el precio?
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          <TouchableOpacity
                            onPress={() => cambiarModoPrecioRow(x.key, 'unidad')}
                            style={{
                              paddingHorizontal: 9,
                              paddingVertical: 4,
                              borderRadius: radius.pill,
                              borderWidth: 1,
                              borderColor: modoRow === 'unidad' ? colors.brand : colors.border,
                              backgroundColor: modoRow === 'unidad' ? colors.brand : colors.surfaceAlt,
                            }}
                          >
                            <Text style={{ fontSize: 10.5, fontWeight: '800', color: modoRow === 'unidad' ? colors.brandContrast : colors.text }}>
                              🎯 Por Unidad (c/u)
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => cambiarModoPrecioRow(x.key, 'total')}
                            style={{
                              paddingHorizontal: 9,
                              paddingVertical: 4,
                              borderRadius: radius.pill,
                              borderWidth: 1,
                              borderColor: modoRow === 'total' ? '#7C3AED' : colors.border,
                              backgroundColor: modoRow === 'total' ? '#7C3AED' : colors.surfaceAlt,
                            }}
                          >
                            <Text style={{ fontSize: 10.5, fontWeight: '800', color: modoRow === 'total' ? '#fff' : colors.text }}>
                              📦 Precio Total ({qNum} {x.unit || 'und'})
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })()}

                  {/* 🔢 Cantidad, Unidad, Precio en $ USD y Precio en Bs (Responsive Teléfono / PC) */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 62 }}>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cant</Text>
                      <TextInput
                        value={x.qty}
                        onChangeText={(t) => handleQtyChange(x.key, t)}
                        keyboardType="numeric"
                        inputMode="decimal"
                        style={[inp, { textAlign: 'center' }]}
                      />
                    </View>
                    <View style={{ width: 70 }}>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Unidad</Text>
                      <TextInput
                        value={x.unit}
                        onChangeText={(t) => upd(x.key, 'unit', t.toUpperCase())}
                        placeholder="UND"
                        placeholderTextColor={colors.muted}
                        style={inp}
                      />
                    </View>

                    {/* 💵 Barra Precio Dólares ($ USD) */}
                    <View style={{ flex: 1, minWidth: 120 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <Text style={{ color: (x.modo_precio || 'unidad') === 'total' ? '#7C3AED' : colors.brandText, fontSize: 11, fontWeight: '800' }}>
                          {(x.modo_precio || 'unidad') === 'total' ? '📦 Total ($ USD)' : '💵 Unitario c/u ($ USD)'}
                        </Text>
                        {rate && rate > 0 ? (
                          <TouchableOpacity onPress={() => recomputarDesdeBcv(x.key, 'VES')} style={{ paddingHorizontal: 2 }}>
                            <Text style={{ color: colors.muted, fontSize: 10 }}>🔄 de Bs</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <TextInput
                        value={(x.modo_precio || 'unidad') === 'total' ? (x.total_usd ?? x.price) : x.price}
                        onChangeText={(t) => handlePrecioUsdChange(x.key, t)}
                        keyboardType="numeric"
                        inputMode="decimal"
                        placeholder="0.00"
                        placeholderTextColor={colors.muted}
                        style={[inp, { textAlign: 'right', fontWeight: '800', borderColor: (x.modo_precio || 'unidad') === 'total' ? '#7C3AED' : colors.border }]}
                      />
                    </View>

                    {/* 🇻🇪 Barra Precio Bolívares (Bs) */}
                    <View style={{ flex: 1, minWidth: 120 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <Text style={{ color: '#0D9488', fontSize: 11, fontWeight: '800' }}>
                          {(x.modo_precio || 'unidad') === 'total' ? '📦 Total (Bs)' : '🇻🇪 Unitario c/u (Bs)'}
                        </Text>
                        {rate && rate > 0 ? (
                          <TouchableOpacity onPress={() => recomputarDesdeBcv(x.key, 'USD')} style={{ paddingHorizontal: 2 }}>
                            <Text style={{ color: colors.muted, fontSize: 10 }}>🔄 de $</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <TextInput
                        value={(x.modo_precio || 'unidad') === 'total' ? (x.total_bs ?? x.price_bs) : x.price_bs}
                        onChangeText={(t) => handlePrecioBsChange(x.key, t)}
                        keyboardType="numeric"
                        inputMode="decimal"
                        placeholder="0.00"
                        placeholderTextColor={colors.muted}
                        style={[inp, { textAlign: 'right', fontWeight: '800' }]}
                      />
                    </View>
                  </View>

                  {/* Resumen automático de Unitario vs Total del renglón */}
                  {(() => {
                    const q = Math.max(0.0001, parseNum(x.qty) || 1);
                    const uUsd = parseNum(x.price);
                    const uBs = parseNum(x.price_bs);
                    const tUsd = rowUsd(x);
                    const tBs = rowBs(x);
                    if (uUsd <= 0 && uBs <= 0 && tUsd <= 0 && tBs <= 0) return null;
                    return (
                      <View style={{
                        marginTop: 5,
                        paddingVertical: 4,
                        paddingHorizontal: 8,
                        borderRadius: radius.sm,
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 6,
                      }}>
                        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '700' }}>
                          🎯 Unitario c/u: <Text style={{ color: colors.text, fontWeight: '800' }}>{usd(uUsd)}{uBs > 0 ? ` / ${fmtBs(uBs)}` : ''}</Text>
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.brandText, fontWeight: '800' }}>
                          📦 Total ({qtyFmt(q)} {x.unit || 'und'}): {usd(tUsd)}{tBs > 0 ? ` / ${fmtBs(tBs)}` : ''}
                        </Text>
                      </View>
                    );
                  })()}

                  {/* Indicador de Tasa Implícita del Renglón si se ingresó USD y Bs manualmente */}
                  {(() => {
                    const u = parseNum(x.price);
                    const b = parseNum(x.price_bs);
                    const tasaItem = u > 0 && b > 0 ? (b / u) : null;
                    const esDistinto = tasaItem && rate && Math.abs(tasaItem - rate) > 0.05;
                    const metObj = x.metodo_pago ? METODOS_PAGO_COTIZACION.find((m) => m.key === x.metodo_pago) : null;

                    if (!tasaItem && !metObj) return null;

                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4, flexWrap: 'wrap', gap: 4 }}>
                        {tasaItem ? (
                          <Text style={{ fontSize: 10.5, color: '#0D9488', fontWeight: '800' }}>
                            ⚡ Tasa propia del ítem: {tasaItem.toFixed(2)} Bs/$ {esDistinto ? `(BCV: ${rate?.toFixed(2)})` : ''}
                          </Text>
                        ) : <View />}
                        {metObj ? (
                          <View style={{ backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#86EFAC', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 10, color: '#15803D', fontWeight: '800' }}>
                              {metObj.icon} Cotizado en: {metObj.label}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })()}

                  {/* 🧾 Fila de Acciones por Renglón: Exento de IVA y Presupuestos Comparativos */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                    {/* Cuadro Exento de IVA (idéntico a Compra Directa) */}
                    <TouchableOpacity
                      onPress={() => upd(x.key, 'exento', !x.exento)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingVertical: 4,
                        paddingHorizontal: 8,
                        borderRadius: radius.sm,
                        backgroundColor: x.exento ? '#E0F2FE' : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: x.exento ? '#0284C7' : colors.border,
                        alignSelf: 'flex-start',
                      }}
                    >
                      <Text style={{ color: x.exento ? '#0369A1' : colors.muted, fontSize: 13, fontWeight: '900' }}>
                        {x.exento ? '☑' : '☐'}
                      </Text>
                      <Text style={{ color: x.exento ? '#0369A1' : colors.text, fontSize: 12, fontWeight: x.exento ? '800' : '600' }}>
                        Exento de IVA
                      </Text>
                    </TouchableOpacity>

                    {/* Botón para desplegar / agregar uno o varios presupuestos en la cotización de este renglón */}
                    <TouchableOpacity
                      onPress={() => upd(x.key, 'presupuestosAbierto', !x.presupuestosAbierto)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingVertical: 4,
                        paddingHorizontal: 10,
                        borderRadius: radius.pill,
                        backgroundColor: (x.presupuestos || []).length > 0 ? '#F3E8FF' : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: (x.presupuestos || []).length > 0 ? '#A855F7' : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 12 }}>📋</Text>
                      <Text style={{ color: (x.presupuestos || []).length > 0 ? '#7E22CE' : colors.text, fontSize: 11.5, fontWeight: '700' }}>
                        {(x.presupuestos || []).length === 0
                          ? '＋ Cotización / Presupuestos (1 o varios)'
                          : `Presupuestos en cotización (${(x.presupuestos || []).length}) ${x.presupuestosAbierto ? '▲' : '▼'}`}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* 📋 Bloque desplegable de Presupuestos / Cotizaciones múltiples para este producto */}
                  {x.presupuestosAbierto ? (
                    <View style={{ marginTop: 8, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.xs }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>
                          📋 Cotización · Uno o varios Presupuestos
                        </Text>
                        <TouchableOpacity
                          onPress={() => agregarPresupuesto(x.key)}
                          style={{ backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 }}
                        >
                          <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '800' }}>＋ Agregar presupuesto</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        Puedes registrar uno o varios presupuestos para este objeto, indicando el precio por unidad o el precio total, y adjuntar sus soportes (PDF/fotos). Toca "✓ Elegir este presupuesto" para aplicarlo al ítem.
                      </Text>

                      {(x.presupuestos || []).map((cot, ci) => {
                        const modoCot = cot.modo_precio || 'unidad';
                        const qCot = Math.max(0.0001, parseNum(x.qty) || 1);
                        const uUsdCot = parseNum(cot.precio_usd);
                        const uBsCot = parseNum(cot.precio_bs);
                        const tUsdCot = parseNum(cot.total_usd || '0') || (uUsdCot * qCot);
                        const tBsCot = parseNum(cot.total_bs || '0') || (uBsCot * qCot);
                        return (
                          <View key={cot.id} style={{ backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginTop: 4 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.brandText }}>Presupuesto #{ci + 1}</Text>
                              <TouchableOpacity onPress={() => eliminarPresupuesto(x.key, cot.id)}>
                                <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>🗑 Quitar</Text>
                              </TouchableOpacity>
                            </View>

                            <TextInput
                              value={cot.proveedor}
                              onChangeText={(t) => actualizarPresupuesto(x.key, cot.id, 'proveedor', t)}
                              placeholder="Nombre del proveedor o tienda (ej. Repuestos El Sol)"
                              placeholderTextColor={colors.muted}
                              style={[inp, { fontSize: 12, marginBottom: 4 }]}
                            />

                            {/* 💳 Método de Pago de este presupuesto */}
                            <View style={{ marginTop: 2, marginBottom: 6 }}>
                              <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3, fontWeight: '700' }}>
                                💳 Condición / Método de Pago:
                              </Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
                                {METODOS_PAGO_COTIZACION.map((m) => {
                                  const active = (cot.metodo_pago || 'efectivo_usd') === m.key;
                                  return (
                                    <TouchableOpacity
                                      key={m.key}
                                      onPress={() => actualizarPresupuesto(x.key, cot.id, 'metodo_pago', m.key)}
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 4,
                                        paddingHorizontal: 8,
                                        paddingVertical: 3,
                                        borderRadius: radius.pill,
                                        borderWidth: 1,
                                        borderColor: active ? colors.brand : colors.border,
                                        backgroundColor: active ? (isDark ? '#1E293B' : '#EFF6FF') : colors.surfaceAlt,
                                      }}
                                    >
                                      <Text style={{ fontSize: 11 }}>{m.icon}</Text>
                                      <Text style={{ fontSize: 10.5, fontWeight: active ? '800' : '600', color: active ? colors.brandText : colors.text }}>
                                        {m.label}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            </View>

                            {/* 🎯 Selector: Precio por Unidad vs Precio Total en este presupuesto */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                              <Text style={{ fontSize: 10, color: colors.muted, fontWeight: '700' }}>Modo de precio:</Text>
                              <View style={{ flexDirection: 'row', gap: 4 }}>
                                <TouchableOpacity
                                  onPress={() => cambiarModoPrecioPresupuesto(x.key, cot.id, 'unidad')}
                                  style={{
                                    paddingHorizontal: 8,
                                    paddingVertical: 3,
                                    borderRadius: radius.pill,
                                    borderWidth: 1,
                                    borderColor: modoCot === 'unidad' ? colors.brand : colors.border,
                                    backgroundColor: modoCot === 'unidad' ? colors.brand : colors.surfaceAlt,
                                  }}
                                >
                                  <Text style={{ fontSize: 10, fontWeight: '800', color: modoCot === 'unidad' ? colors.brandContrast : colors.text }}>
                                    🎯 Por Unidad (c/u)
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => cambiarModoPrecioPresupuesto(x.key, cot.id, 'total')}
                                  style={{
                                    paddingHorizontal: 8,
                                    paddingVertical: 3,
                                    borderRadius: radius.pill,
                                    borderWidth: 1,
                                    borderColor: modoCot === 'total' ? '#7C3AED' : colors.border,
                                    backgroundColor: modoCot === 'total' ? '#7C3AED' : colors.surfaceAlt,
                                  }}
                                >
                                  <Text style={{ fontSize: 10, fontWeight: '800', color: modoCot === 'total' ? '#fff' : colors.text }}>
                                    📦 Precio Total ({qtyFmt(qCot)} {x.unit || 'und'})
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>

                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 10, color: modoCot === 'total' ? '#7C3AED' : colors.muted, fontWeight: '700', marginBottom: 2 }}>
                                  {modoCot === 'total' ? `📦 Total ($ USD)` : `🎯 Unitario c/u ($ USD)`}
                                </Text>
                                <TextInput
                                  value={modoCot === 'total' ? (cot.total_usd ?? cot.precio_usd) : cot.precio_usd}
                                  onChangeText={(t) => actualizarPresupuesto(x.key, cot.id, modoCot === 'total' ? 'total_usd' : 'precio_usd', t)}
                                  keyboardType="numeric"
                                  inputMode="decimal"
                                  placeholder="$ 0.00"
                                  placeholderTextColor={colors.muted}
                                  style={[inp, { textAlign: 'right', fontSize: 12, fontWeight: '700' }]}
                                />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 10, color: colors.muted, fontWeight: '700', marginBottom: 2 }}>
                                  {modoCot === 'total' ? `📦 Total (Bs)` : `🎯 Unitario c/u (Bs)`}
                                </Text>
                                <TextInput
                                  value={modoCot === 'total' ? (cot.total_bs ?? cot.precio_bs) : cot.precio_bs}
                                  onChangeText={(t) => actualizarPresupuesto(x.key, cot.id, modoCot === 'total' ? 'total_bs' : 'precio_bs', t)}
                                  keyboardType="numeric"
                                  inputMode="decimal"
                                  placeholder="Bs 0.00"
                                  placeholderTextColor={colors.muted}
                                  style={[inp, { textAlign: 'right', fontSize: 12, fontWeight: '700' }]}
                                />
                              </View>
                            </View>

                            {/* Resumen automático Unitario y Total del Presupuesto */}
                            {uUsdCot > 0 || uBsCot > 0 || tUsdCot > 0 || tBsCot > 0 ? (
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, marginTop: 4, backgroundColor: colors.surfaceAlt, paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.sm }}>
                                <Text style={{ fontSize: 10, color: colors.muted, fontWeight: '700' }}>
                                  Unitario: {usd(uUsdCot)}{uBsCot > 0 ? ` / ${fmtBs(uBsCot)}` : ''} c/u
                                </Text>
                                <Text style={{ fontSize: 10, color: colors.brandText, fontWeight: '800' }}>
                                  Total ({qtyFmt(qCot)} {x.unit || 'und'}): {usd(tUsdCot)}{tBsCot > 0 ? ` / ${fmtBs(tBsCot)}` : ''}
                                </Text>
                              </View>
                            ) : null}

                            {uUsdCot > 0 && uBsCot > 0 ? (
                              <Text style={{ fontSize: 9.5, color: '#0D9488', fontWeight: '700', marginTop: 3 }}>
                                ⚡ Tasa implícita de este presupuesto: {(uBsCot / uUsdCot).toFixed(2)} Bs/$
                              </Text>
                            ) : null}

                            <TextInput
                              value={cot.nota || ''}
                              onChangeText={(t) => actualizarPresupuesto(x.key, cot.id, 'nota', t)}
                              placeholder="Nota: entrega inmediata, garantía, marca, N° de presupuesto…"
                              placeholderTextColor={colors.muted}
                              style={[inp, { fontSize: 11.5, marginTop: 4 }]}
                            />

                            {/* 📎 Soportes / Archivos del presupuesto (uno o varios archivos PDF o fotos) */}
                            <View style={{ marginTop: 6 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                                <Text style={{ fontSize: 10, color: colors.muted, fontWeight: '700' }}>
                                  📎 Soportes del presupuesto ({(cot.archivos || []).length}):
                                </Text>
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                  <TouchableOpacity
                                    onPress={() => subirArchivoPresupuestoItem(x.key, cot.id, 'camara')}
                                    disabled={subiendoPresupuestoId === cot.id}
                                    style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}
                                  >
                                    <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.text }}>📷 Foto</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => subirArchivoPresupuestoItem(x.key, cot.id, 'archivo')}
                                    disabled={subiendoPresupuestoId === cot.id}
                                    style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}
                                  >
                                    <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.brandText }}>
                                      {subiendoPresupuestoId === cot.id ? '⏳ Subiendo…' : '📎 Subir PDF / Imagen(es)'}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                              {(cot.archivos || []).length > 0 ? (
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                  {(cot.archivos || []).map((arch) => (
                                    <View
                                      key={arch.id}
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 4,
                                        backgroundColor: colors.surfaceAlt,
                                        borderWidth: 1,
                                        borderColor: colors.border,
                                        borderRadius: radius.sm,
                                        paddingHorizontal: 6,
                                        paddingVertical: 2,
                                      }}
                                    >
                                      <TouchableOpacity onPress={() => Linking.openURL(arch.url)}>
                                        <Text style={{ fontSize: 10.5, color: colors.brandText, fontWeight: '700' }}>
                                          {arch.kind === 'pdf' ? '📄' : '🖼️'} {arch.name}
                                        </Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity onPress={() => quitarArchivoPresupuestoItem(x.key, cot.id, arch.id)}>
                                        <Text style={{ fontSize: 10.5, color: colors.danger, fontWeight: '900' }}>✕</Text>
                                      </TouchableOpacity>
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                            </View>

                            <TouchableOpacity
                              onPress={() => aplicarPresupuestoAlItem(x.key, cot)}
                              style={{
                                marginTop: 8,
                                alignSelf: 'flex-start',
                                backgroundColor: '#DCFCE7',
                                borderWidth: 1,
                                borderColor: '#16A34A',
                                borderRadius: radius.pill,
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                              }}
                            >
                              <Text style={{ color: '#15803D', fontSize: 11, fontWeight: '800' }}>
                                ✓ Elegir este presupuesto para el ítem
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}

                      {(x.presupuestos || []).length === 0 ? (
                        <TouchableOpacity
                          onPress={() => agregarPresupuesto(x.key)}
                          style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center', marginTop: 4 }}
                        >
                          <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>＋ Toca para registrar el primer presupuesto</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Imagen de referencia del producto: sale en el PDF junto a su descripción. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                    {x.image_url ? (
                      <Image source={{ uri: x.image_url }} style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} />
                    ) : (
                      <View style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 22 }}>📷</Text>
                      </View>
                    )}
                    <TouchableOpacity onPress={() => subirImagenProducto(x.key)} disabled={subiendoImgKey === x.key} style={{ flex: 1, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoImgKey === x.key ? 0.6 : 1 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>{subiendoImgKey === x.key ? '⏳ Subiendo…' : x.image_url ? '🖼️ Cambiar imagen' : '🖼️ Imagen del producto'}</Text>
                    </TouchableOpacity>
                    {x.image_url ? (
                      <TouchableOpacity onPress={() => upd(x.key, 'image_url', '')}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Quitar</Text></TouchableOpacity>
                    ) : null}
                  </View>

                  {/* Asignación individual de proveedor por renglón (Multi-proveedor con checkbox y buscador vertical) */}
                  <ItemSupplierPicker
                    supplierId={x.supplier_id}
                    supplierName={x.supplier_name}
                    suppliers={suppliers}
                    onSelect={(id, name) => {
                      upd(x.key, 'supplier_id', id);
                      upd(x.key, 'supplier_name', name);
                    }}
                  />
                </Card>
              );
            })}

            {/* 🧾 Desglose Financiero con IVA idéntico a Compra Directa */}
            {rows.length ? (
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>IVA %</Text>
                  <TextInput
                    value={alicuotaIva}
                    onChangeText={setAlicuotaIva}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    placeholder="16"
                    placeholderTextColor={colors.muted}
                    style={{
                      width: 80,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 6,
                      color: colors.text,
                      fontSize: 13,
                      textAlign: 'right',
                      fontWeight: '800',
                    }}
                  />
                  <Text style={{ color: colors.muted, fontSize: 11, flex: 1 }}>
                    Nace en 16%. Colócalo en 0 si el requerimiento completo no lleva IVA.
                  </Text>
                </View>

                {(() => {
                  const subUsd = createSubtotalUsd;
                  const baseUsd = createBaseImponibleUsd;
                  const exentoUsd = createExentoUsd;
                  const alic = createAlicuotaNum;
                  const ivaUsd = createIvaUsd;
                  const totalUsd = createTotalUsd;

                  const subBs = createSubtotalBs;
                  const baseBs = createBaseImponibleBs;
                  const exentoBs = createExentoBs;
                  const ivaBs = createIvaBs;
                  const totalBs = createTotalBs;

                  const fila = (label: string, usdVal: number, bsVal: number, highlight?: boolean, esTotal?: boolean) => {
                    return (
                      <View
                        key={label}
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: esTotal ? 8 : 3,
                          paddingTop: esTotal ? 6 : 0,
                          borderTopWidth: esTotal ? 1.5 : 0,
                          borderTopColor: colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: esTotal ? colors.text : (highlight ? '#0369A1' : colors.muted),
                            fontSize: esTotal ? 14 : 12,
                            fontWeight: esTotal ? '900' : (highlight ? '700' : '600'),
                          }}
                        >
                          {label}
                        </Text>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text
                            style={{
                              color: esTotal ? colors.brandText : colors.text,
                              fontSize: esTotal ? 16 : 13,
                              fontWeight: esTotal ? '900' : '700',
                              fontVariant: ['tabular-nums'],
                            }}
                          >
                            {usd(usdVal)}
                          </Text>
                          {bsVal > 0 || (rate && rate > 0) ? (
                            <Text
                              style={{
                                color: colors.muted,
                                fontSize: esTotal ? 11.5 : 10.5,
                                fontVariant: ['tabular-nums'],
                              }}
                            >
                              {fmtBs(bsVal)}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  };

                  return (
                    <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                      {fila('Subtotal', subUsd, subBs)}
                      {exentoUsd > 0 || exentoBs > 0 ? fila('Exento de IVA', exentoUsd, exentoBs, true) : null}
                      {exentoUsd > 0 || exentoBs > 0 ? fila('Base imponible (gravada)', baseUsd, baseBs) : null}
                      {fila(`IVA (${alic}%)`, ivaUsd, ivaBs)}
                      {fila('TOTAL ESTIMADO', totalUsd, totalBs, false, true)}
                    </View>
                  );
                })()}
              </Card>
            ) : <EmptyState title="Sin productos" subtitle="Agrega productos del inventario o nuevos." />}

            {/* Adjuntar FORMATOS (imágenes o PDFs múltiples): cotizaciones, fotos del repuesto, planillas… */}
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📎 Formatos y Soportes (opcional)</Text>
                {formatos.length > 0 ? (
                  <View style={{ backgroundColor: '#EFF6FF', borderColor: '#3B82F6', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: '#1D4ED8', fontSize: 11, fontWeight: '800' }}>{formatos.length} archivo(s)</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                Puedes subir dos o más archivos (cotizaciones en PDF, fotos del repuesto, presupuestos escaneados). El jefe podrá revisarlos y descargarlos.
              </Text>

              {formatos.length > 0 ? (
                <View style={{ gap: spacing.xs, marginBottom: spacing.sm }}>
                  {formatos.map((fmt, idx) => (
                    <View
                      key={fmt.id || idx}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.sm,
                        backgroundColor: colors.surfaceAlt,
                        borderRadius: radius.md,
                        padding: spacing.xs,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      {fmt.kind === 'image' ? (
                        <Image source={{ uri: fmt.url }} style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface }} />
                      ) : (
                        <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 24 }}>📄</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                          {fmt.name || `Formato ${idx + 1}`}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                          {fmt.kind === 'pdf' ? 'Documento PDF' : 'Imagen'} · Adjunto #{idx + 1}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => quitarFormato(fmt.id)}
                        style={{ padding: spacing.xs }}
                      >
                        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️ Quitar</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  onPress={adjuntarFormatoNuevo}
                  disabled={subiendoNuevo}
                  style={{
                    flex: 1,
                    minWidth: 140,
                    borderWidth: 1,
                    borderColor: colors.brand,
                    borderRadius: radius.md,
                    paddingVertical: spacing.sm,
                    alignItems: 'center',
                    backgroundColor: colors.surfaceAlt,
                    opacity: subiendoNuevo ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>
                    {subiendoNuevo ? '⏳ Subiendo…' : '＋ Adjuntar archivo(s)'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={tomarFotoFormatoNuevo}
                  disabled={subiendoNuevo}
                  style={{
                    flex: 1,
                    minWidth: 110,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    paddingVertical: spacing.sm,
                    alignItems: 'center',
                    backgroundColor: colors.surfaceAlt,
                    opacity: subiendoNuevo ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                    📷 Tomar foto
                  </Text>
                </TouchableOpacity>
              </View>
            </Card>

            {/* 💳 CONDICIONES DE PAGO DE ESTA COMPRA — viaja automáticamente a Por Pagar */}
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>
                💳 Condiciones de pago de esta compra (opcional)
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Cada compra o requerimiento puede tener sus propias condiciones. Se mostrarán directo en Cuentas por Pagar para quien realiza el pago.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {CONDICIONES_PAGO_CHIPS.map((chipLabel) => {
                  const activo = condicionesPago.toUpperCase().includes(chipLabel.toUpperCase());
                  return (
                    <TouchableOpacity
                      key={chipLabel}
                      onPress={() => setCondicionesPago(toggleChipCondicionPago(condicionesPago, chipLabel))}
                      style={{
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: activo ? colors.brand : colors.border,
                        backgroundColor: activo ? colors.brand : colors.surfaceAlt,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 5,
                      }}
                    >
                      <Text style={{ color: activo ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>
                        {activo ? `✓ ${chipLabel}` : chipLabel}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={condicionesPago}
                onChangeText={setCondicionesPago}
                placeholder="Ej. 50% adelanto y 50% contra entrega · Transferencia Bs BCV…"
                placeholderTextColor={colors.muted}
                style={inp}
              />
            </Card>

            {/* 📝 OBSERVACIONES — al final, como se pidió: «un espacio de
                observaciones para escribir cualquier cosa que necesite o
                información adicional». Sale impreso al final del formato. */}
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>📝 Observaciones (opcional)</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Cualquier información adicional. Sale al final del formato que ve el jefe.</Text>
              <TextInput
                value={observaciones}
                onChangeText={setObservaciones}
                placeholder="Escribe aquí lo que haga falta…"
                placeholderTextColor={colors.muted}
                multiline
                style={[inp, { minHeight: 80, textAlignVertical: 'top' }]}
              />
            </Card>

            {formErr ? (
              <View style={{ marginTop: spacing.sm, backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.dangerSoftText, fontWeight: '700', fontSize: 13 }}>⚠️ {formErr}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => { setCreateOpen(false); limpiarForm(); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : (editId ? '💾 Guardar cambios' : '📤 Enviar al jefe')}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Vista previa del FORMATO adjunto (imagen o PDF) + descarga (soporte de 1 o más formatos) ── */}
      <Modal visible={!!previewReq} animationType="fade" transparent onRequestClose={() => setPreviewReq(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%', overflow: 'hidden' }}>
            {(() => {
              const reqFormatos = previewReq ? extraerFormatosAdjuntos(previewReq) : [];
              const safeIndex = Math.min(Math.max(0, previewIndex), Math.max(0, reqFormatos.length - 1));
              const currentFmt = reqFormatos[safeIndex] || (previewReq?.attachment_url ? {
                id: 'legado',
                url: previewReq.attachment_url,
                kind: previewReq.attachment_type || 'image',
                name: previewReq.attachment_name || 'Formato',
              } : null);

              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ flex: 1, marginRight: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>
                        📎 {currentFmt?.name || previewReq?.attachment_name || 'Formato'}
                      </Text>
                      {reqFormatos.length > 1 ? (
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>
                          Archivo {safeIndex + 1} de {reqFormatos.length}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity onPress={() => setPreviewReq(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Pestañas para alternar entre formatos si hay más de 1 */}
                  {reqFormatos.length > 1 ? (
                    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: 6, gap: 6 }}>
                        {reqFormatos.map((fmt, fIdx) => {
                          const active = fIdx === safeIndex;
                          return (
                            <TouchableOpacity
                              key={fmt.id || fIdx}
                              onPress={() => setPreviewIndex(fIdx)}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                                borderRadius: radius.pill,
                                backgroundColor: active ? colors.brand : colors.surface,
                                borderWidth: 1,
                                borderColor: active ? colors.brand : colors.border,
                              }}
                            >
                              <Text style={{ fontSize: 11 }}>{fmt.kind === 'pdf' ? '📄' : '🖼️'}</Text>
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: active ? '800' : '600',
                                  color: active ? colors.brandContrast : colors.text,
                                }}
                                numberOfLines={1}
                              >
                                {fmt.name ? (fmt.name.length > 20 ? fmt.name.slice(0, 18) + '…' : fmt.name) : `Adjunto ${fIdx + 1}`}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}

                  <ScrollView style={{ padding: spacing.md }}>
                    {currentFmt?.url ? (
                      currentFmt.kind === 'pdf' ? (
                        Platform.OS === 'web'
                          ? React.createElement('iframe', { src: currentFmt.url, style: { width: '100%', height: '65vh', border: 'none', borderRadius: 8 } })
                          : <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md }}>Toca "⬇️ Descargar / Abrir" para ver el PDF.</Text>
                      ) : (
                        <Image source={{ uri: currentFmt.url }} style={{ width: '100%', height: 420, borderRadius: radius.md }} resizeMode="contain" />
                      )
                    ) : (
                      <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg }}>
                        No hay archivo disponible para visualizar.
                      </Text>
                    )}
                  </ScrollView>

                  <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', gap: spacing.sm }}>
                    {reqFormatos.length > 1 && safeIndex > 0 ? (
                      <TouchableOpacity
                        onPress={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                        style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700' }}>◀ Anterior</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => {
                        if (currentFmt) {
                          descargarFormato({
                            ...previewReq!,
                            attachment_url: currentFmt.url,
                            attachment_name: currentFmt.name,
                            attachment_type: currentFmt.kind,
                          });
                        }
                      }}
                      style={{ flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}
                    >
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Descargar / Abrir archivo</Text>
                    </TouchableOpacity>
                    {reqFormatos.length > 1 && safeIndex < reqFormatos.length - 1 ? (
                      <TouchableOpacity
                        onPress={() => setPreviewIndex((i) => Math.min(reqFormatos.length - 1, i + 1))}
                        style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700' }}>Siguiente ▶</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Recibir en inventario ── */}
      <Modal visible={!!recvFor} animationType="slide" onRequestClose={() => setRecvFor(null)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Recibir en inventario</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Confirma la cantidad y el PRECIO REAL de compra de cada producto. Se registrará como ENTRADA (los nuevos se crean solos). {recvFor?.code ?? ''}</Text>
            {recvRows.map((it, idx) => {
              const otra = it.currency === 'USD' ? fmtBs(bsFromUsd(parseNum(it.price), rate || 0)) : usd(usdFromBs(parseNum(it.price), rate || 0));
              return (
                <Card key={idx}>
                  {/* 🔢 Numerado igual que el requerimiento y su PDF, para ir
                      tachando renglón por renglón al recibir. */}
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}><Text style={{ color: colors.muted }}>{idx + 1}. </Text>{it.name} {it.product_id ? '' : <Text style={{ color: colors.success, fontSize: 11 }}>· NUEVO</Text>}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cantidad</Text><TextInput value={it.qty} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, qty: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio real (unit.)</Text><TextInput value={it.price} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, price: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
                    <TouchableOpacity onPress={() => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, currency: r.currency === 'USD' ? 'VES' : 'USD' } : r))} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{it.currency === 'USD' ? '$' : 'Bs'}</Text>
                    </TouchableOpacity>
                  </View>
                  {parseNum(it.price) > 0 && rate ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>≈ {otra} c/u</Text> : null}
                  <View style={{ marginTop: 6 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>📝 Nota del producto (opcional)</Text>
                    <TextInput
                      value={it.note || ''}
                      onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, note: t } : r))}
                      placeholder="Ej: marca recibida, presentación, serial o detalle de este ítem…"
                      placeholderTextColor={colors.muted}
                      style={[inp, { fontSize: 12 }]}
                    />
                  </View>
                </Card>
              );
            })}

            {/* 🧾 Carga de Factura de Compra / Soporte Fiscal y Nota de Recepción (Para Almacén y Cuentas por Pagar) */}
            <Card style={{ marginTop: spacing.sm, borderWidth: 1.5, borderColor: '#0284C7', backgroundColor: '#F0F9FF' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Text style={{ fontSize: 16 }}>🧾</Text>
                <Text style={{ color: '#0369A1', fontWeight: '800', fontSize: 13 }}>
                  Factura de Compra / Soporte Fiscal
                </Text>
              </View>
              <Text style={{ color: '#075985', fontSize: 11.5, marginBottom: spacing.xs }}>
                Ingresa los datos de la factura para que queden registrados en Almacén y en Cuentas por Pagar no tenga que volver a subirlos.
              </Text>

              <Text style={{ color: '#0C4A6E', fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
                N° de Factura / Control:
              </Text>
              <TextInput
                value={recvFacturaNumero}
                onChangeText={setRecvFacturaNumero}
                placeholder="Ej: FACT-009842 o CTRL-1102"
                placeholderTextColor="#94A3B8"
                style={[inp, { backgroundColor: '#fff', marginBottom: spacing.xs }]}
              />

              <Text style={{ color: '#0C4A6E', fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
                Foto o Documento PDF de la Factura:
              </Text>
              {recvFacturaUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: '#BAE6FD', marginBottom: spacing.xs }}>
                  <Text style={{ fontSize: 20 }}>{recvFacturaTipo === 'pdf' ? '📄' : '🖼️'}</Text>
                  <Text style={{ flex: 1, fontSize: 12, color: colors.text }} numberOfLines={1}>{recvFacturaNombre || 'Factura adjunta'}</Text>
                  <TouchableOpacity onPress={() => { setRecvFacturaUrl(null); setRecvFacturaTipo(null); setRecvFacturaNombre(null); }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
                  <TouchableOpacity
                    onPress={() => subirFacturaRecibir('camara')}
                    disabled={recvSubiendoFactura}
                    style={{ flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0284C7', paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', opacity: recvSubiendoFactura ? 0.6 : 1 }}
                  >
                    <Text style={{ color: '#0284C7', fontWeight: '700', fontSize: 12 }}>
                      {recvSubiendoFactura ? '⏳ Subiendo…' : '📷 Tomar Foto'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => subirFacturaRecibir('archivo')}
                    disabled={recvSubiendoFactura}
                    style={{ flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0284C7', paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', opacity: recvSubiendoFactura ? 0.6 : 1 }}
                  >
                    <Text style={{ color: '#0284C7', fontWeight: '700', fontSize: 12 }}>
                      {recvSubiendoFactura ? '⏳ Subiendo…' : '📎 Subir Archivo/PDF'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={{ color: '#0C4A6E', fontSize: 11, fontWeight: '700', marginTop: 4, marginBottom: 2 }}>
                📝 Nota / Observación de Recepción (opcional):
              </Text>
              <TextInput
                value={recvNota}
                onChangeText={setRecvNota}
                placeholder="Ej: Recibido conforme en almacén, entregado por chofer, observación de la factura o recepción…"
                placeholderTextColor="#94A3B8"
                multiline
                style={[inp, { backgroundColor: '#fff', minHeight: 62, textAlignVertical: 'top' }]}
              />
            </Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setRecvFor(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={recibir} disabled={recvBusy} style={{ flex: 2, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: recvBusy ? 0.6 : 1 }}><Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{recvBusy ? 'Recibiendo…' : '📥 Confirmar entrada'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Datos Financieros del Proveedor (en tiempo real) ── */}
      <Modal visible={modalPagoProvOpen} animationType="slide" onRequestClose={() => setModalPagoProvOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Datos de Pago del Proveedor</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Registra o actualiza las coordenadas de pago de {provParaPago?.name ?? 'el proveedor'} para agilizar la transición a Tesorería.
            </Text>

            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🏦 Transferencia Bancaria (Nacional)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Banco</Text>
              <TextInput value={provBanco} onChangeText={setProvBanco} placeholder="Ej. Banesco, Mercantil, BDV…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Número de Cuenta (20 dígitos)</Text>
              <TextInput value={provNumCuenta} onChangeText={(t) => setProvNumCuenta(t.replace(/\D/g, '').slice(0, 20))} keyboardType="numeric" placeholder="0134..." placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Tipo de Cuenta</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: 6 }}>
                {(['Corriente', 'Ahorro'] as const).map((tipo) => (
                  <TouchableOpacity key={tipo} onPress={() => setProvTipoCuenta(tipo)} style={{ flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: provTipoCuenta === tipo ? colors.brand : colors.border, backgroundColor: provTipoCuenta === tipo ? colors.brand : colors.surfaceAlt, alignItems: 'center' }}>
                    <Text style={{ color: provTipoCuenta === tipo ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{tipo}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Nombre del Titular</Text>
              <TextInput value={provTitular} onChangeText={setProvTitular} autoCapitalize="words" placeholder="Nombre de la empresa o titular" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cédula / RIF del Titular</Text>
              <TextInput value={provDocTitular} onChangeText={setProvDocTitular} autoCapitalize="none" placeholder="J-12345678-9 o V-12345678" placeholderTextColor={colors.muted} style={inp} />
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>📱 Pago Móvil</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Banco Pago Móvil</Text>
              <TextInput value={provPagoMovilBanco} onChangeText={setProvPagoMovilBanco} autoCapitalize="words" placeholder="Ej. Banesco, BDV, Mercantil…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Teléfono Pago Móvil</Text>
              <TextInput value={provPagoMovilTel} onChangeText={setProvPagoMovilTel} keyboardType="phone-pad" placeholder="0414-1234567" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cédula / RIF Pago Móvil</Text>
              <TextInput value={provPagoMovilDoc} onChangeText={setProvPagoMovilDoc} autoCapitalize="none" placeholder="V-12345678 o J-12345678-9" placeholderTextColor={colors.muted} style={inp} />
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🟡 Billetera Digital (Binance Pay / Cripto)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Binance Pay ID / Correo</Text>
              <TextInput value={provBinanceId} onChangeText={setProvBinanceId} autoCapitalize="none" keyboardType="email-address" placeholder="Binance ID o correo de cuenta" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6, textTransform: 'none' }]} {...rawCaseField} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Notas adicionales de pago (opcional)</Text>
              <TextInput value={provNotasPago} onChangeText={setProvNotasPago} autoCapitalize="none" placeholder="Instrucciones especiales de pago…" placeholderTextColor={colors.muted} multiline style={[inp, { minHeight: 50, textAlignVertical: 'top', textTransform: 'none' }]} {...rawCaseField} />
            </Card>

            {/* 📸 Captura de Pago / Billetera TRX / Tron / QR */}
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>
                  📸 Captura de Billetera TRX / Tron / QR Banco
                </Text>
                {provPaymentPhotoUrl ? (
                  <View style={{ backgroundColor: '#064E3B', borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: '#34D399', fontSize: 10, fontWeight: '800' }}>✓ Adjuntada</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 6 }}>
                Captura de pantalla de la billetera (TRC-20, TRX, Tron, QR bancario) enviada por el proveedor.
              </Text>

              {provPaymentPhotoUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceAlt, padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 8 }}>
                  <Image
                    source={{ uri: provPaymentPhotoUrl }}
                    style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: '#000' }}
                    resizeMode="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                      {provPaymentPhotoName || 'Captura de pago / QR'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <TouchableOpacity
                        onPress={() => setVisorCapturaProv({ url: provPaymentPhotoUrl, name: provPaymentPhotoName })}
                        style={{ backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm }}
                      >
                        <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '800' }}>👁️ Ver grande</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setProvPaymentPhotoUrl('');
                          setProvPaymentPhotoName('');
                        }}
                        style={{ backgroundColor: colors.dangerSoftBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.dangerSoftBorder }}
                      >
                        <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>✕ Quitar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  disabled={subiendoCapturaProv}
                  onPress={tomarFotoCapturaProv}
                  style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}
                >
                  <Text style={{ fontSize: 14 }}>📷</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                    {subiendoCapturaProv ? 'Cargando…' : 'Tomar Foto'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={subiendoCapturaProv}
                  onPress={subirCapturaProvArchivo}
                  style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}
                >
                  <Text style={{ fontSize: 14 }}>📎</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                    {subiendoCapturaProv ? 'Subiendo…' : 'Subir Captura'}
                  </Text>
                </TouchableOpacity>
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setModalPagoProvOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarPagoProv} disabled={guardandoPagoProv} style={{ flex: 2, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardandoPagoProv ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardandoPagoProv ? 'Guardando…' : '💾 Guardar Datos de Pago'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* Visor modal de captura de pago de proveedor */}
      <Modal visible={!!visorCapturaProv} transparent animationType="fade" onRequestClose={() => setVisorCapturaProv(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}>
          <View style={{ width: '100%', maxWidth: 500, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>
                📸 {visorCapturaProv?.name || 'Captura de Billetera / QR'}
              </Text>
              <TouchableOpacity onPress={() => setVisorCapturaProv(null)} style={{ padding: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 18, fontWeight: '900' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ alignItems: 'center', padding: spacing.md }}>
              {visorCapturaProv?.url ? (
                <Image
                  source={{ uri: visorCapturaProv.url }}
                  style={{ width: '100%', height: 420, borderRadius: radius.md }}
                  resizeMode="contain"
                />
              ) : null}
            </ScrollView>
            <View style={{ padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              {visorCapturaProv?.url ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(visorCapturaProv.url)}
                  style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🔗 Abrir original</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => setVisorCapturaProv(null)}
                style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.brand }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '700', fontSize: 12 }}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal: Solicitar Aclaratoria Técnica (Bucle de Cotización) ── */}
      <Modal visible={aclaratoriaOpen} animationType="fade" transparent onRequestClose={() => setAclaratoriaOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>🔄 Solicitud de Información Adicional</Text>
              <TouchableOpacity onPress={() => setAclaratoriaOpen(false)}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: spacing.sm }}>
              Requerimiento {aclaratoriaTarget?.code ?? ''}: El ticket volverá al departamento solicitante y no podrá ser aprobado hasta recibir las especificaciones técnicas requeridas.
            </Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
              Detalles técnicos requeridos (tolerancias, medidas, fotos, material):
            </Text>
            <TextInput
              value={aclaratoriaMotivo}
              onChangeText={setAclaratoriaMotivo}
              placeholder="Indica qué medidas, tolerancias, dimensiones o especificaciones de catálogo hacen falta para poder cotizar..."
              placeholderTextColor={colors.muted}
              multiline
              style={[inp, { minHeight: 90, textAlignVertical: 'top', marginBottom: spacing.md }]}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setAclaratoriaOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={enviarSolicitudAclaratoria} disabled={aclaratoriaBusy} style={{ flex: 2, backgroundColor: '#D97706', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: aclaratoriaBusy ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{aclaratoriaBusy ? 'Enviando…' : '⚠️ Enviar Solicitud'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal: Responder Aclaratoria Técnica (Solicitante) ── */}
      <Modal visible={respuestaOpen} animationType="fade" transparent onRequestClose={() => setRespuestaOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>📝 Respuesta Técnica de Aclaratoria</Text>
              <TouchableOpacity onPress={() => setRespuestaOpen(false)}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: spacing.xs }}>
              Requerimiento {respuestaTarget?.code ?? ''}: Ingresa las especificaciones o dimensiones solicitadas por Compras. Al responder, el ticket volverá a la cola de aprobación.
            </Text>
            {respuestaTarget?.aclaratoria_motivo ? (
              <View style={{ backgroundColor: '#FEF3C7', padding: spacing.sm, borderRadius: radius.md, marginBottom: spacing.sm }}>
                <Text style={{ color: '#92400E', fontWeight: '800', fontSize: 11 }}>Información solicitada por Compras:</Text>
                <Text style={{ color: '#B45309', fontSize: 12, marginTop: 2 }}>{respuestaTarget.aclaratoria_motivo}</Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
              Respuesta / Especificaciones técnicas:
            </Text>
            <TextInput
              value={respuestaTexto}
              onChangeText={setRespuestaTexto}
              placeholder="Escribe las dimensiones exactas, tolerancia, material, número de parte o detalles técnicos..."
              placeholderTextColor={colors.muted}
              multiline
              style={[inp, { minHeight: 90, textAlignVertical: 'top', marginBottom: spacing.md }]}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setRespuestaOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={enviarRespuestaAclaratoria} disabled={respuestaBusy} style={{ flex: 2, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: respuestaBusy ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{respuestaBusy ? 'Enviando…' : '📤 Enviar Respuesta Técnica'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal: Carga de Factura Fiscal / Comercial y Recibo de Pago (Expediente Unificado) ── */}
      <Modal visible={facturaModalOpen} animationType="slide" onRequestClose={() => setFacturaModalOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>🧾 Expediente: Factura y Recibo de Pago</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Requerimiento {facturaTarget?.code ?? ''}: Carga y gestiona en un solo lugar la factura comercial/fiscal y el comprobante de transferencia o recibo de pago para trazabilidad directa con Cuentas por Pagar.
            </Text>

            {/* Tarjeta 1: Factura Fiscal / Comercial */}
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs }}>
                <Text style={{ fontSize: 16 }}>🧾</Text>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                  1. Factura Fiscal / Comercial
                </Text>
              </View>

              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
                Empresa Emisora de la Factura:
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

            {/* Tarjeta 2: Recibo o Comprobante de Pago Bancario */}
            <Card style={{ marginBottom: spacing.sm, borderColor: '#10B981', borderWidth: 1.5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs }}>
                <Text style={{ fontSize: 16 }}>💳</Text>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                  2. Recibo o Comprobante de Pago Bancario
                </Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
                Registra la transferencia, pago móvil o captura de pago para liquidación.
              </Text>

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>N° de Referencia / Comprobante</Text>
              <TextInput
                value={reciboPagoRef}
                onChangeText={setReciboPagoRef}
                placeholder="Ej. Ref #893421 o Voucher 4410"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.sm }]}
              />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Método de Pago</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                {['Transferencia', 'Pago Móvil', 'Binance / USDT', 'Zelle', 'Efectivo'].map((m) => {
                  const sel = reciboPagoMetodo === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setReciboPagoMetodo(m)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: sel ? '#10B981' : colors.border,
                        backgroundColor: sel ? '#ECFDF5' : colors.surfaceAlt,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '700', color: sel ? '#065F46' : colors.text }}>
                        {m}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Fecha de Pago (AAAA-MM-DD)</Text>
              <TextInput
                value={reciboPagoFecha}
                onChangeText={setReciboPagoFecha}
                placeholder="2026-10-26"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.sm }]}
              />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Foto o Documento del Recibo / Comprobante</Text>
              {reciboPagoUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ECFDF5', padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: '#10B981', marginBottom: spacing.sm }}>
                  <Text style={{ fontSize: 22 }}>{reciboPagoTipo === 'pdf' ? '📄' : '💳'}</Text>
                  <Text style={{ flex: 1, fontSize: 12, color: '#065F46', fontWeight: '700' }} numberOfLines={1}>
                    {reciboPagoNombre || 'Recibo de pago adjunto'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => abrirVisorFactura(reciboPagoUrl, reciboPagoTipo, reciboPagoNombre || 'Recibo')}
                    style={{ backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: '#10B981' }}
                  >
                    <Text style={{ color: '#047857', fontSize: 11, fontWeight: '700' }}>Ver</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setReciboPagoUrl(null); setReciboPagoNombre(null); }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11 }}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                  <TouchableOpacity
                    onPress={tomarFotoReciboPago}
                    disabled={subiendoReciboPago}
                    style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: '#10B981', paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', opacity: subiendoReciboPago ? 0.6 : 1 }}
                  >
                    <Text style={{ color: '#047857', fontWeight: '700', fontSize: 12 }}>
                      {subiendoReciboPago ? '⏳ Subiendo…' : '📷 Foto Recibo'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={subirArchivoReciboPago}
                    disabled={subiendoReciboPago}
                    style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: '#10B981', paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', opacity: subiendoReciboPago ? 0.6 : 1 }}
                  >
                    <Text style={{ color: '#047857', fontWeight: '700', fontSize: 12 }}>
                      {subiendoReciboPago ? '⏳ Subiendo…' : '📎 Subir Archivo/PDF'}
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
                  {guardandoFactura ? 'Guardando…' : '💾 Guardar Expediente'}
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

      {/* ── Modal: Configuración de Umbral de Aprobación por Monto, Empresa y Personas ── */}
      <Modal visible={configModalOpen} animationType="fade" transparent onRequestClose={() => setConfigModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 16 }}>⚙️</Text>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>Umbral de Aprobación Dinámico</Text>
              </View>
              <TouchableOpacity onPress={() => setConfigModalOpen(false)}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: spacing.md }}>
              Configura el monto a partir del cual las compras exigen aprobación especial obligatoria, asignable a una empresa en específico o a todas, y a qué responsables/personas autorizadas corresponde.
            </Text>

            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
              Monto Límite en Dólares (USD):
            </Text>
            <TextInput
              value={cfgMonto}
              onChangeText={setCfgMonto}
              keyboardType="numeric"
              placeholder="1000"
              placeholderTextColor={colors.muted}
              style={[inp, { marginBottom: spacing.md }]}
            />

            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
              Aplica a la Empresa:
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              <TouchableOpacity
                onPress={() => { setCfgEmpresaId(null); setCfgEmpresaNombre('Todas las empresas'); }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: cfgEmpresaId === null ? colors.brand : colors.border,
                  backgroundColor: cfgEmpresaId === null ? colors.surfaceAlt : 'transparent',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '800', color: cfgEmpresaId === null ? colors.brandText : colors.text }}>
                  🌐 Todas las empresas
                </Text>
              </TouchableOpacity>
              {companies.map((c) => {
                const sel = cfgEmpresaId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => { setCfgEmpresaId(c.id); setCfgEmpresaNombre(c.name); }}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: sel ? colors.brand : colors.border,
                      backgroundColor: sel ? colors.surfaceAlt : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '800', color: sel ? colors.brandText : colors.text }}>
                      🏢 {c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
              Personas / Cargos Autorizados a Aprobar:
            </Text>
            <TextInput
              value={cfgAprobadoresNombres.join(', ')}
              onChangeText={(t) => setCfgAprobadoresNombres(t.split(',').map((x) => x.trim()).filter(Boolean))}
              placeholder="Ej. Gerencia General, Anthony, Director Ejecutivo"
              placeholderTextColor={colors.muted}
              style={[inp, { marginBottom: spacing.lg }]}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setConfigModalOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarConfigModal} style={{ flex: 2, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>💾 Guardar Umbral</Text>
              </TouchableOpacity>
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

      {/* ── Modal de Cotizaciones Múltiples y Multi-Moneda ── */}
      <CotizacionesModal
        visible={cotizacionesModalOpen}
        onClose={() => { setCotizacionesModalOpen(false); setCotizacionesTarget(null); }}
        requirementCode={cotizacionesTarget?.code}
        requirementItems={cotizacionesTarget?.items || []}
        cotizaciones={cotizacionesTarget ? getReqCotizaciones(cotizacionesTarget) : []}
        suppliers={suppliers}
        rateBcv={rate || 0}
        canEdit={canWrite}
        onSaveCotizaciones={guardarCotizacionesReq}
      />
    </Screen>
  );
}
