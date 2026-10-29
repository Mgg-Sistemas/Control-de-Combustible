// ── Solicitud de Material / Repuestos (Existencia vs Compra Técnica) ───────
// Permite que mecánicos (ej. Osma), encargados de taller, supervisores o
// cualquier personal externo a Compras consulte existencias y solicite repuestos.
// 1) Si hay stock en Almacén: genera Solicitud de Despacho (inventory_stock_requests).
// 2) Si NO hay stock o es pieza nueva: genera Solicitud de Compra Técnica (inventory_requirements)
//    con medidas técnicas OBLIGATORIAS, foto y ciclo de aclaratorias.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Badge, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { norm, onlyDecimal } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import {
  InventoryLevel,
  InventoryStockRequest,
  InventoryRequirement,
  Machinery,
  Vehicle,
  Employee,
  Contacto,
  StockRequestUrgency,
  Supplier,
} from '../types/database';
import { pickAndUploadRequirementFile, captureAndUploadPhoto } from '../lib/photo';
import { PersonaNominaPicker } from '../components/PersonaNominaPicker';
import {
  areasSugeridas,
  contactoDesdeNombre,
  personasDeNomina,
  SIN_PERSONA,
  type PersonaElegida,
} from '../lib/requerimientoPersonas';
import {
  nextStockRequestCode,
  URGENCIA_CONFIG,
  ESTADO_EXISTENCIA_CONFIG,
  ESTADO_COMPRA_CONFIG,
  ESTADO_GRUPO_CONFIG,
  MOTIVOS_CANCELACION_RAPIDOS,
  formatCancellationNote,
  isCancelledNote,
  parseCancelacionNote,
  extraerCancelacionCompra,
  puedeCancelarSolicitudStock,
  puedeCancelarSolicitudCompra,
  parseRejectionNote,
  agruparSolicitudesStock,
  type GrupoSolicitudStock,
} from '../lib/solicitudMaterial';
import { calcularEstadoRequerimiento, type InfoEstadoRequerimiento } from '../lib/requerimientoFlujo';
import {
  extraerFactura,
  extraerDespacho,
  expedienteCompletoHtml,
} from '../lib/requerimientoExpediente';
import { exportPdf, urlToDataUri } from '../lib/pdf';
import { machineLabel } from '../lib/machineLabel';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

export interface SolicitudCartItem {
  id: string;
  tipo: 'stock' | 'compra';
  itemId?: string | null;
  name: string;
  sku?: string | null;
  unit: string;
  qty: number;
  stockDisponible?: number;
  urgency?: StockRequestUrgency;
  reason?: string;
  medidas?: string;
  fotoUrl?: string | null;
  proveedorSugerido?: {
    nombre?: string;
    telefono?: string;
    direccion?: string;
  } | null;
}

const parseNum = leerNumero;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
const nowISO = () => new Date().toISOString();
const parseFriendlyError = (e: any, fallback: string) => {
  const msg = String(e?.message || '');
  if (/row-level security|policy/i.test(msg)) {
    return 'Permiso RLS insuficiente en la base de datos para inventory_requirements. Aplica la política RLS para solicitudes_material en Supabase.';
  }
  return msg || fallback;
};
const dmyOf = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const dmyTimeOf = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12 || 12;
  const m = p(d.getMinutes());
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${h}:${m} ${ampm}`;
};

/** Lo que distingue a una máquina en pantalla: «Placa: X · Serial: Y», o solo lo que tenga.
 *  Muchas máquinas no tienen placa y sí serial (26-oct-2026: «si no tiene placa, tiene serial»). */
function placaSerial(m: { plate?: string | null; serial?: string | null }): string {
  const placa = String(m.plate ?? '').trim();
  const serial = String(m.serial ?? '').trim();
  const partes = [placa ? `Placa: ${placa}` : '', serial ? `Serial: ${serial}` : ''].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Sin placa ni serial';
}

export default function SolicitudMaterialScreen() {
  const { colors, scheme } = useTheme();
  const { session, fullName, role, moduleLevel } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const uid = session?.user?.id ?? null;
  const esAdmin =
    role === 'admin' ||
    levelMeets(moduleLevel('inventario'), 'escritura') ||
    levelMeets(moduleLevel('compras'), 'escritura');

  // Si es admin o acceso full en compras/inventario, ve todo por defecto
  const [verTodosAdmin, setVerTodosAdmin] = useState(esAdmin);
  useEffect(() => {
    if (esAdmin) setVerTodosAdmin(true);
  }, [esAdmin]);

  // Pestaña activa: 'nueva' (crear solicitud) | 'mis_solicitudes' (historial y seguimiento)
  const [tab, setTab] = useState<'nueva' | 'mis_solicitudes'>('nueva');

  // Catálogos
  const { data: levels, loading: levelsLoading } = useTable<InventoryLevel>('inventory_levels', {
    orderBy: 'name',
    realtimeFrom: ['inventory_movements', 'inventory_items'],
  });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: vehicles } = useTable<Vehicle>('vehicles', { orderBy: 'plate' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: contacts } = useTable<Contacto>('contactos', { orderBy: 'name' });

  // Solicitudes existentes
  const {
    data: stockRequests,
    loading: stockReqsLoading,
    refetch: refetchStockReqs,
  } = useTable<InventoryStockRequest>('inventory_stock_requests', {
    orderBy: 'created_at',
    ascending: false,
  });

  const {
    data: requirements,
    loading: reqsLoading,
    refetch: refetchReqs,
  } = useTable<InventoryRequirement>('inventory_requirements', {
    orderBy: 'created_at',
    ascending: false,
  });

  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });

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

  // ── PASO 1: Destino y Solicitante ──────────────────────────────────────────
  const [destinoTipo, setDestinoTipo] = useState<'maquinaria' | 'vehiculo' | 'area'>('maquinaria');
  // Multi-selección de maquinaria y vehículos
  const [selectedMachineryIds, setSelectedMachineryIds] = useState<string[]>([]);
  const [machineryQuery, setMachineryQuery] = useState<string>('');
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [vehicleQuery, setVehicleQuery] = useState<string>('');
  const [areaTexto, setAreaTexto] = useState<string>('');
  const [solicitante, setSolicitante] = useState<PersonaElegida>(() => {
    return fullName ? { nombre: fullName.trim(), employeeId: null } : SIN_PERSONA;
  });

  const machineryId = selectedMachineryIds[0] || '';
  const vehicleId = selectedVehicleIds[0] || '';

  const toggleMachinery = (id: string) => {
    setSelectedMachineryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleVehicle = (id: string) => {
    setSelectedVehicleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Carrito de repuestos / materiales agregados
  const [cartItems, setCartItems] = useState<SolicitudCartItem[]>([]);
  const [submittingCart, setSubmittingCart] = useState<boolean>(false);

  const agregarItemAlCarrito = (item: Omit<SolicitudCartItem, 'id'>) => {
    const id = 'it-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
    setCartItems((prev) => {
      if (item.tipo === 'stock' && item.itemId) {
        const existIdx = prev.findIndex((x) => x.tipo === 'stock' && x.itemId === item.itemId);
        if (existIdx >= 0) {
          const clon = [...prev];
          clon[existIdx] = {
            ...clon[existIdx],
            qty: clon[existIdx].qty + item.qty,
            reason: item.reason || clon[existIdx].reason,
            urgency: item.urgency || clon[existIdx].urgency,
          };
          return clon;
        }
      }
      return [...prev, { ...item, id }];
    });
    toast.success(`"${item.name}" agregado a tu lista (${qtyFmt(item.qty)} ${item.unit}).`);
  };

  const quitarItemDelCarrito = (id: string) => {
    setCartItems((prev) => prev.filter((it) => it.id !== id));
  };

  const cambiarCantidadCarrito = (id: string, delta: number) => {
    setCartItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const newQty = Math.max(1, Math.round((it.qty + delta) * 100) / 100);
        return { ...it, qty: newQty };
      })
    );
  };

  const setCantidadDirecta = (id: string, text: string) => {
    const val = parseNum(text);
    setCartItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        return { ...it, qty: val >= 0 ? val : 1 };
      })
    );
  };

  // Filtro de maquinarias por código, placa, tipo, marca, modelo o serial
  const machinesFiltradas = useMemo(() => {
    const list = machines || [];
    const q = norm(machineryQuery);
    if (!q) return list;
    return list.filter((m) => {
      return (
        norm(m.code || '').includes(q) ||
        (m.plate && norm(m.plate).includes(q)) ||
        (m.serial && norm(m.serial).includes(q)) ||
        (m.marca && norm(m.marca).includes(q)) ||
        (m.modelo && norm(m.modelo).includes(q)) ||
        (m.tipo && norm(m.tipo).includes(q)) ||
        (m.clasificacion && norm(m.clasificacion).includes(q))
      );
    });
  }, [machines, machineryQuery]);

  // Filtro de vehículos por placa, marca o modelo
  const vehiclesFiltrados = useMemo(() => {
    const list = vehicles || [];
    const q = norm(vehicleQuery);
    if (!q) return list;
    return list.filter((v) => {
      return (
        (v.plate && norm(v.plate).includes(q)) ||
        (v.brand && norm(v.brand).includes(q)) ||
        (v.model && norm(v.model).includes(q))
      );
    });
  }, [vehicles, vehicleQuery]);

  const personasNomina = useMemo(() => personasDeNomina(employees), [employees]);
  const contactosSimples = useMemo(() => (contacts || []).map((c) => ({ id: c.id, name: c.name })), [contacts]);

  // Guardar contacto escrito a mano
  const guardarContacto = async (nombre: string): Promise<string | null> => {
    try {
      const fila = contactoDesdeNombre(nombre);
      if (!fila) return null;
      const { error } = await supabase.from('contactos').insert({ ...fila, created_by: uid ?? null });
      return error ? error.message : null;
    } catch (e: any) {
      return e?.message ?? 'No se pudo guardar el contacto';
    }
  };

  // Buscador de existencias en almacén
  const [query, setQuery] = useState('');
  const productosFiltrados = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    return levels.filter((it) => {
      const matchName = norm(it.name).includes(q);
      const matchSku = it.sku && norm(it.sku).includes(q);
      const matchCat = it.category && norm(it.category).includes(q);
      return matchName || matchSku || matchCat;
    });
  }, [levels, query]);

  // ── MODAL: Solicitud de Despacho / Existencia ─────────────────────────────────
  const [modalStockOpen, setModalStockOpen] = useState(false);
  const [stockItem, setStockItem] = useState<InventoryLevel | null>(null);
  const [stockQty, setStockQty] = useState('1');
  const [stockUrgencia, setStockUrgencia] = useState<StockRequestUrgency>('normal');
  const [stockMotivo, setStockMotivo] = useState('');
  const [stockBusy, setStockBusy] = useState(false);

  const abrirPedirStock = (item: InventoryLevel) => {
    setStockItem(item);
    setStockQty('1');
    setStockUrgencia('normal');
    setStockMotivo('');
    setModalStockOpen(true);
  };

  const enviarSolicitudStock = async () => {
    if (!stockItem) return;
    const qty = Math.max(1, parseNum(stockQty));
    if (qty <= 0) {
      return toast.error('Ingresa una cantidad válida a solicitar.');
    }
    if (qty > (stockItem.stock || 0)) {
      const ok = await confirm({
        title: 'Cantidad superior al stock actual',
        message: `El almacén registra ${qtyFmt(stockItem.stock)} ${stockItem.unit || ''} disponibles y estás pidiendo ${qtyFmt(qty)}. ¿Deseas solicitar esta cantidad de todos modos?`,
        confirmText: 'Solicitar de todos modos',
      });
      if (!ok) return;
    }

    setStockBusy(true);
    try {
      // Correlativo
      const codigos = (stockRequests || []).map((r) => r.code);
      const code = nextStockRequestCode(codigos);

      const targetMachine = destinoTipo === 'maquinaria' ? machineryId || null : null;
      const targetVehicle = destinoTipo === 'vehiculo' ? vehicleId || null : null;
      const targetArea = destinoTipo === 'area' ? areaTexto.trim() || null : null;

      const payload = {
        code,
        item_id: stockItem.id,
        item_name: stockItem.name,
        unit: stockItem.unit,
        qty,
        machinery_id: targetMachine,
        vehicle_id: targetVehicle,
        area: targetArea,
        solicitante_nombre: solicitante.nombre || fullName || 'Personal Taller',
        solicitante_employee_id: solicitante.employeeId || null,
        urgency: stockUrgencia,
        reason: stockMotivo.trim() || null,
        status: 'pendiente',
        created_by: uid,
      };

      const { error } = await supabase.from('inventory_stock_requests').insert(payload);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) {
          throw new Error(
            'La tabla de Solicitudes de Existencia aún no ha sido ejecutada en Supabase. Corre el archivo supabase/solicitudes_existencia.sql en el SQL Editor.'
          );
        }
        throw error;
      }

      toast.success(`Solicitud ${code} enviada al Almacén con éxito.`);
      setModalStockOpen(false);
      refetchStockReqs();
      setTab('mis_solicitudes');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo enviar la solicitud de existencia.');
    } finally {
      setStockBusy(false);
    }
  };

  // ── MODAL: Solicitud de Compra Técnica ──────────────────────────────────────
  const [modalCompraOpen, setModalCompraOpen] = useState(false);
  const [compraItemName, setCompraItemName] = useState('');
  const [compraProductId, setCompraProductId] = useState<string | null>(null);
  const [compraMedidas, setCompraMedidas] = useState('');
  const [compraQty, setCompraQty] = useState('1');
  const [compraUnit, setCompraUnit] = useState('UND');
  const [compraMotivo, setCompraMotivo] = useState('');
  const [compraFoto, setCompraFoto] = useState<string | null>(null);
  const [compraSubiendoFoto, setCompraSubiendoFoto] = useState(false);
  const [compraBusy, setCompraBusy] = useState(false);

  // 🏬 Proveedor Sugerido (Opcional - Audio Jefes de Dpto)
  const [compraProvNombre, setCompraProvNombre] = useState('');
  const [compraProvTelefono, setCompraProvTelefono] = useState('');
  const [compraProvDireccion, setCompraProvDireccion] = useState('');

  const abrirPedirCompra = (item?: InventoryLevel | null) => {
    if (item) {
      setCompraItemName(item.name);
      setCompraProductId(item.id);
      setCompraUnit(item.unit || 'UND');
    } else {
      setCompraItemName(query.trim());
      setCompraProductId(null);
      setCompraUnit('UND');
    }
    setCompraMedidas('');
    setCompraQty('1');
    setCompraMotivo('');
    setCompraFoto(null);
    setCompraProvNombre('');
    setCompraProvTelefono('');
    setCompraProvDireccion('');
    setModalCompraOpen(true);
  };

  const tomarFotoCompra = async (origen: 'camara' | 'galeria') => {
    setCompraSubiendoFoto(true);
    try {
      if (origen === 'camara') {
        const r = await captureAndUploadPhoto('requerimientos');
        if (r.ok && r.url) setCompraFoto(r.url);
        else if (r.error) toast.error(r.error);
      } else {
        const r = await pickAndUploadRequirementFile('requerimientos_temp');
        if (r.ok && r.url) setCompraFoto(r.url);
        else if (r.error) toast.error(r.error);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo cargar la imagen.');
    } finally {
      setCompraSubiendoFoto(false);
    }
  };

  const enviarSolicitudCompra = async () => {
    if (!compraItemName.trim()) {
      return toast.error('Indica el nombre del repuesto o pieza a comprar.');
    }
    // ⚠️ Validación obligatoria de especificaciones técnicas (solicitada por el usuario)
    if (!compraMedidas.trim()) {
      return toast.error(
        'Las medidas y especificaciones técnicas son OBLIGATORIAS (diámetro, rosca, paso, N° de parte, etc.) para que Compras y el proveedor no detengan la compra.'
      );
    }
    const qty = Math.max(1, parseNum(compraQty));

    setCompraBusy(true);
    try {
      // Generar correlativo REQ-####
      const { data: codeRows } = await supabase.from('inventory_requirements').select('code');
      let max = 0;
      (codeRows || []).forEach((c: any) => {
        const m = String(c?.code ?? '').match(/(\d+)\s*$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) max = n;
        }
      });
      const code = 'REQ-' + String(max + 1).padStart(4, '0');

      // Máquina/Vehículo snapshot
      const targetMach = machines.find((m) => m.id === machineryId);
      const targetVeh = vehicles.find((v) => v.id === vehicleId);

      const targetLabel =
        destinoTipo === 'maquinaria'
          ? targetMach
            ? `Maquinaria ${targetMach.code}${targetMach.plate ? ' · Placa: ' + targetMach.plate : ''}${targetMach.serial ? ' · Serial: ' + targetMach.serial : ''}${[targetMach.marca, targetMach.modelo].filter(Boolean).join(' ') ? ` (${[targetMach.marca, targetMach.modelo].filter(Boolean).join(' ')})` : ''}`
            : 'Maquinaria'
          : destinoTipo === 'vehiculo'
          ? targetVeh
            ? `Vehículo ${targetVeh.plate} (${[targetVeh.brand, targetVeh.model].filter(Boolean).join(' ') || 'Vehículo'})`
            : 'Vehículo'
          : areaTexto.trim() || 'Taller General';

      const provInfo =
        compraProvNombre.trim() || compraProvTelefono.trim() || compraProvDireccion.trim()
          ? `\n[PROVEEDOR SUGERIDO: Nombre: ${compraProvNombre.trim() || 'No indicado'} | Tel: ${compraProvTelefono.trim() || 'No indicado'} | Dirección: ${compraProvDireccion.trim() || 'No indicada'}]`
          : '';

      const items = [
        {
          product_id: compraProductId,
          name: compraItemName.trim(),
          unit: compraUnit.trim().toUpperCase() || 'UND',
          qty,
          est_price: 0,
          currency: 'USD' as const,
          note: `${compraMedidas.trim()}${provInfo ? ` · Prov. sugerido: ${compraProvNombre.trim() || 'Ver observaciones'}` : ''}`,
          image_url: compraFoto || null,
        },
      ];

      const solicitanteNombre =
        solicitante.nombre || fullName || session?.user?.email || 'Taller';

      const payload = {
        code,
        title: `Pedido técnico: ${compraItemName.trim()} para ${targetLabel}`,
        note: compraMotivo.trim()
          ? `MOTIVO: ${compraMotivo.trim()} · ESPECIFICACIONES: ${compraMedidas.trim()}${provInfo}`
          : `ESPECIFICACIONES: ${compraMedidas.trim()}${provInfo}`,
        status: 'pendiente',
        items,
        requested_by: uid,
        requested_by_name: fullName || session?.user?.email || 'Taller',
        solicitante_nombre: solicitanteNombre,
        solicitante_employee_id: solicitante.employeeId || null,
        destino_tipo: destinoTipo === 'maquinaria' || destinoTipo === 'vehiculo' ? destinoTipo : null,
        area: destinoTipo === 'area' ? areaTexto.trim() || null : 'TALLER / MANTENIMIENTO',
        observaciones: `Solicitud creada desde el portal técnico de taller para ${targetLabel}.${provInfo}`,
        attachment_url: compraFoto || null,
        attachment_type: compraFoto ? 'image' : null,
      };

      const { error } = await supabase.from('inventory_requirements').insert(payload);
      if (error) throw error;

      toast.success(`Requerimiento de compra ${code} enviado al departamento de Compras.`);
      setModalCompraOpen(false);
      refetchReqs();
      setTab('mis_solicitudes');
    } catch (e: any) {
      toast.error(parseFriendlyError(e, 'No se pudo crear la solicitud de compra.'));
    } finally {
      setCompraBusy(false);
    }
  };

  // ── ENVIAR SOLICITUD COMPLETA (MÚLTIPLES REPUESTOS Y MÚLTIPLES EQUIPOS) ─────────
  const enviarSolicitudCompleta = async () => {
    if (cartItems.length === 0) {
      return toast.error('Agrega al menos un repuesto a la solicitud antes de enviar.');
    }

    if (destinoTipo === 'maquinaria' && selectedMachineryIds.length === 0) {
      return toast.error('Selecciona al menos una maquinaria para asignar la solicitud.');
    }
    if (destinoTipo === 'vehiculo' && selectedVehicleIds.length === 0) {
      return toast.error('Selecciona al menos un vehículo para asignar la solicitud.');
    }
    if (destinoTipo === 'area' && !areaTexto.trim()) {
      return toast.error('Indica el área o departamento de destino.');
    }

    setSubmittingCart(true);
    try {
      // 1. Armar etiquetas de destino
      let targetLabel = '';
      let targetPrimaryMachine: string | null = null;
      let targetPrimaryVehicle: string | null = null;
      let targetArea: string | null = null;

      if (destinoTipo === 'maquinaria') {
        const selMachs = machines.filter((m) => selectedMachineryIds.includes(m.id));
        targetPrimaryMachine = selMachs[0]?.id || null;
        targetLabel = selMachs
          .map((m) => `${m.code} · ${placaSerial(m)}`)
          .join(', ');
      } else if (destinoTipo === 'vehiculo') {
        const selVehs = vehicles.filter((v) => selectedVehicleIds.includes(v.id));
        targetPrimaryVehicle = selVehs[0]?.id || null;
        targetLabel = selVehs
          .map((v) => `${v.plate} (${[v.brand, v.model].filter(Boolean).join(' ') || 'Vehículo'})`)
          .join(', ');
      } else {
        targetArea = areaTexto.trim().toUpperCase() || 'TALLER GENERAL';
        targetLabel = targetArea;
      }

      const stockItems = cartItems.filter((it) => it.tipo === 'stock');
      const compraItems = cartItems.filter((it) => it.tipo === 'compra');

      const codigosExistentes = (stockRequests || []).map((r) => r.code);

      // Despacho de almacén para ítems de stock (agrupados bajo el mismo pedido si son varios)
      const codigoBaseLote = stockItems.length > 1 ? nextStockRequestCode(codigosExistentes, 0) : null;
      for (let i = 0; i < stockItems.length; i++) {
        const item = stockItems[i];
        const code = nextStockRequestCode(codigosExistentes, i);
        const ordenTag = codigoBaseLote ? `[ORDEN: ${codigoBaseLote}] ` : '';
        const equipTag = targetLabel ? `[Destino: ${targetLabel}]` : '';
        const userReason = item.reason ? ` · ${item.reason}` : '';
        const fullReason = `${ordenTag}${equipTag}${userReason}`.trim() || null;

        const payload = {
          code,
          item_id: item.itemId || null,
          item_name: item.name,
          unit: item.unit || 'UND',
          qty: item.qty,
          machinery_id: targetPrimaryMachine,
          vehicle_id: targetPrimaryVehicle,
          area: destinoTipo === 'area' ? targetArea : targetLabel.slice(0, 100),
          solicitante_nombre: solicitante.nombre || fullName || 'Personal Taller',
          solicitante_employee_id: solicitante.employeeId || null,
          urgency: item.urgency || 'normal',
          reason: fullReason,
          status: 'pendiente',
          created_by: uid,
        };

        const { error } = await supabase.from('inventory_stock_requests').insert(payload);
        if (error) throw error;
      }

      // Requerimiento de compra técnica (agrupado en un único ticket con múltiples renglones)
      if (compraItems.length > 0) {
        const { data: codeRows } = await supabase.from('inventory_requirements').select('code');
        let maxReq = 0;
        (codeRows || []).forEach((c: any) => {
          const m = String(c?.code ?? '').match(/(\d+)\s*$/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > maxReq) maxReq = n;
          }
        });
        const reqCode = 'REQ-' + String(maxReq + 1).padStart(4, '0');

        const provGlobalList = compraItems
          .map((c) => {
            if (!c.proveedorSugerido?.nombre && !c.proveedorSugerido?.telefono && !c.proveedorSugerido?.direccion) return null;
            return `[PROVEEDOR SUGERIDO (${c.name}): Nombre: ${c.proveedorSugerido.nombre || 'No indicado'} | Tel: ${c.proveedorSugerido.telefono || 'No indicado'} | Dirección: ${c.proveedorSugerido.direccion || 'No indicada'}]`;
          })
          .filter(Boolean);
        const provGlobal = provGlobalList.length > 0 ? `\n${provGlobalList.join('\n')}` : '';

        const reqLines = compraItems.map((ci) => {
          const provItemText = ci.proveedorSugerido?.nombre || ci.proveedorSugerido?.telefono
            ? ` · Prov. sugerido: ${[ci.proveedorSugerido.nombre, ci.proveedorSugerido.telefono].filter(Boolean).join(' - ')}`
            : '';
          return {
            product_id: ci.itemId || null,
            name: ci.name.trim(),
            unit: ci.unit.trim().toUpperCase() || 'UND',
            qty: ci.qty,
            est_price: 0,
            currency: 'USD' as const,
            note: `${ci.medidas || ''}${provItemText}`.trim(),
            image_url: ci.fotoUrl || null,
          };
        });

        // 📷 Cada foto queda en SU renglón (items[].image_url). Solo con UN renglón su foto es
        //    también la de la solicitud; con varios no se copia (28-oct-2026).
        const firstPhoto = compraItems.length === 1 ? (compraItems[0].fotoUrl || null) : null;

        const reqPayload = {
          code: reqCode,
          title: `Pedido técnico: ${compraItems.map((c) => c.name).join(', ')} para ${targetLabel}`,
          note: `EQUIPOS: ${targetLabel} · SOLICITUD TÉCNICA CON ${compraItems.length} RENGLÓN(ES)${provGlobal ? ` · PROVEEDORES SUGERIDOS: ${compraItems.map((c) => c.proveedorSugerido?.nombre).filter(Boolean).join(', ')}` : ''}`,
          status: 'pendiente',
          items: reqLines,
          requested_by: uid,
          requested_by_name: fullName || session?.user?.email || 'Taller',
          solicitante_nombre: solicitante.nombre || fullName || 'Personal Taller',
          solicitante_employee_id: solicitante.employeeId || null,
          destino_tipo: destinoTipo === 'maquinaria' || destinoTipo === 'vehiculo' ? destinoTipo : null,
          area: destinoTipo === 'area' ? targetArea : 'TALLER / MANTENIMIENTO',
          observaciones: `Solicitud múltiple creada desde el portal técnico de taller para ${targetLabel}.${provGlobal}`,
          attachment_url: firstPhoto,
          attachment_type: firstPhoto ? 'image' : null,
        };

        const { error: reqErr } = await supabase.from('inventory_requirements').insert(reqPayload);
        if (reqErr) throw reqErr;
      }

      toast.success(`Solicitud de ${cartItems.length} repuesto(s) enviada con éxito.`);
      setCartItems([]);
      refetchStockReqs();
      refetchReqs();
      setTab('mis_solicitudes');
    } catch (e: any) {
      toast.error(parseFriendlyError(e, 'No se pudo enviar la solicitud.'));
    } finally {
      setSubmittingCart(false);
    }
  };

  // ── MODAL: Responder Aclaratoria Técnica de Compras ──────────────────────────
  const [modalAclaratoriaOpen, setModalAclaratoriaOpen] = useState(false);
  const [aclaratoriaTarget, setAclaratoriaTarget] = useState<InventoryRequirement | null>(null);
  const [aclaratoriaRespuesta, setAclaratoriaRespuesta] = useState('');
  const [aclaratoriaBusy, setAclaratoriaBusy] = useState(false);

  const abrirResponderAclaratoria = (r: InventoryRequirement) => {
    setAclaratoriaTarget(r);
    setAclaratoriaRespuesta(r.aclaratoria_respuesta || '');
    setModalAclaratoriaOpen(true);
  };

  const enviarRespuestaAclaratoria = async () => {
    if (!aclaratoriaTarget) return;
    if (!aclaratoriaRespuesta.trim()) {
      return toast.error('Ingresa los detalles técnicos o medidas solicitadas.');
    }

    setAclaratoriaBusy(true);
    try {
      const { error } = await supabase
        .from('inventory_requirements')
        .update({
          status: 'pendiente', // Vuelve a Compras para procesar la cotización
          aclaratoria_respuesta: aclaratoriaRespuesta.trim(),
          aclaratoria_fecha_respuesta: nowISO(),
        })
        .eq('id', aclaratoriaTarget.id);

      if (error) throw error;

      toast.success('Respuesta técnica enviada. El ticket volvió a revisión de compras.');
      setModalAclaratoriaOpen(false);
      setAclaratoriaTarget(null);
      refetchReqs();
    } catch (e: any) {
      toast.error(parseFriendlyError(e, 'No se pudo enviar la respuesta.'));
    } finally {
      setAclaratoriaBusy(false);
    }
  };

  // ── MODAL: Cancelar Solicitud (Almacén o Compra Técnica) ────────────────────
  type CancelTargetInfo = {
    tipo: 'stock_item' | 'stock_grupo' | 'compra' | 'compra_renglon';
    ids: string[];
    codigo: string;
    titulo: string;
    reqCompra?: InventoryRequirement;
    renglonIdx?: number;
  };
  const [modalCancelarOpen, setModalCancelarOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTargetInfo | null>(null);
  const [cancelMotivoChip, setCancelMotivoChip] = useState<string>(MOTIVOS_CANCELACION_RAPIDOS[0].label);
  const [cancelNotaLibre, setCancelNotaLibre] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  const abrirModalCancelar = (target: CancelTargetInfo) => {
    setCancelTarget(target);
    setCancelMotivoChip(MOTIVOS_CANCELACION_RAPIDOS[0].label);
    setCancelNotaLibre('');
    setModalCancelarOpen(true);
  };

  const confirmarCancelacion = async () => {
    if (!cancelTarget || cancelBusy) return;
    const motivoPartes = [
      cancelMotivoChip.trim(),
      cancelNotaLibre.trim(),
    ].filter(Boolean);
    const motivoFinal = motivoPartes.join(' — ') || 'Ya no se necesita';
    const autorNombre = (fullName || '').trim() || 'Solicitante';
    const notaEstructurada = formatCancellationNote(autorNombre, motivoFinal);

    setCancelBusy(true);
    try {
      if (cancelTarget.tipo === 'stock_item' || cancelTarget.tipo === 'stock_grupo') {
        const { data: upd, error } = await supabase
          .from('inventory_stock_requests')
          .update({
            status: 'rechazado',
            rejection_note: notaEstructurada,
          })
          .in('id', cancelTarget.ids)
          .eq('status', 'pendiente')
          .select('id');

        if (error) throw error;
        if (!upd || upd.length === 0) {
          throw new Error('No se pudo cancelar: la solicitud ya fue despachada o procesada por Almacén.');
        }

        toast.success(
          upd.length > 1
            ? `Se cancelaron ${upd.length} repuestos pendientes del pedido ${cancelTarget.codigo}.`
            : `Solicitud ${cancelTarget.codigo} cancelada correctamente.`
        );
        setModalCancelarOpen(false);
        setCancelTarget(null);
        refetchStockReqs();
      } else if (cancelTarget.tipo === 'compra_renglon' && cancelTarget.reqCompra && typeof cancelTarget.renglonIdx === 'number') {
        const reqActual = cancelTarget.reqCompra;
        const itemsActuales = Array.isArray(reqActual.items) ? [...reqActual.items] : [];
        if (itemsActuales.length <= 1) {
          throw new Error('Si solo queda un renglón, cancela la solicitud completa.');
        }
        const eliminado = itemsActuales[cancelTarget.renglonIdx];
        const nuevosItems = itemsActuales.filter((_, idx) => idx !== cancelTarget.renglonIdx);
        const obsPrev = String(reqActual.observaciones ?? '').trim();
        const trazaRenglon = `[Renglón cancelado por ${autorNombre}: ${eliminado?.name || 'Ítem'} (${motivoFinal})]`;
        const nuevasObs = [obsPrev, trazaRenglon].filter(Boolean).join('\n');

        const { data: upd, error } = await supabase
          .from('inventory_requirements')
          .update({
            items: nuevosItems,
            observaciones: nuevasObs,
          })
          .eq('id', reqActual.id)
          .in('status', ['pendiente', 'aclaratoria_solicitada'])
          .select('id');

        if (error) throw error;
        if (!upd || upd.length === 0) {
          throw new Error('No se pudo quitar el renglón: la solicitud ya cambió de estado o no tienes permiso de actualización.');
        }

        toast.success(`Renglón "${eliminado?.name || ''}" quitado de ${reqActual.code}.`);
        setModalCancelarOpen(false);
        setCancelTarget(null);
        refetchReqs();
      } else if (cancelTarget.tipo === 'compra') {
        const reqId = cancelTarget.ids[0];
        const { data: upd, error } = await supabase
          .from('inventory_requirements')
          .update({
            status: 'rechazado',
            decided_by: uid,
            decided_by_name: autorNombre,
            decided_at: nowISO(),
            decision_note: notaEstructurada,
          })
          .eq('id', reqId)
          .in('status', ['pendiente', 'aclaratoria_solicitada'])
          .select('id');

        if (error) throw error;
        if (!upd || upd.length === 0) {
          throw new Error('No se pudo cancelar: la solicitud ya fue procesada por Compras o no tienes permiso de actualización.');
        }

        toast.success(`Solicitud de compra ${cancelTarget.codigo} cancelada correctamente.`);
        setModalCancelarOpen(false);
        setCancelTarget(null);
        refetchReqs();
      }
    } catch (e: any) {
      toast.error(parseFriendlyError(e, 'No se pudo cancelar la solicitud.'));
      refetchStockReqs();
      refetchReqs();
    } finally {
      setCancelBusy(false);
    }
  };

  // ── Filtrado: cada quien ve sus propios pedidos, admin puede ver todo ─────
  const stockRequestsFiltradas = useMemo(() => {
    if (esAdmin && verTodosAdmin) return stockRequests || [];
    return (stockRequests || []).filter((s) => {
      // Filtrar estrictamente por el usuario que creó la solicitud
      if (s.created_by && s.created_by === uid) return true;
      return false;
    });
  }, [stockRequests, esAdmin, verTodosAdmin, uid]);

  const gruposStockFiltrados = useMemo(() => {
    return agruparSolicitudesStock(stockRequestsFiltradas || []);
  }, [stockRequestsFiltradas]);

  // Plegado / Desplegado de tarjetas consolidadas en Mis Solicitudes
  const [expandidosStock, setExpandidosStock] = useState<Record<string, boolean>>({});

  const toggleExpandStock = (id: string, defaultOpen: boolean) => {
    setExpandidosStock((prev) => {
      const current = prev[id] !== undefined ? prev[id] : defaultOpen;
      return { ...prev, [id]: !current };
    });
  };

  const expandirTodosStock = () => {
    const next: Record<string, boolean> = {};
    gruposStockFiltrados.forEach((g) => { next[g.id] = true; });
    setExpandidosStock(next);
  };

  const plegarTodosStock = () => {
    const next: Record<string, boolean> = {};
    gruposStockFiltrados.forEach((g) => { next[g.id] = false; });
    setExpandidosStock(next);
  };

  const requirementsFiltradas = useMemo(() => {
    const soloTecnicas = (requirements || []).filter((r) => {
      return (
        Boolean(r.solicitante_nombre) ||
        (r.title && r.title.toLowerCase().includes('pedido técnico')) ||
        (r.observaciones && r.observaciones.toLowerCase().includes('portal técnico'))
      );
    });

    if (esAdmin && verTodosAdmin) return soloTecnicas;

    return soloTecnicas.filter((r) => {
      // Filtrar estrictamente por el usuario que creó la solicitud o por nombre si coincide
      if (r.requested_by && r.requested_by === uid) return true;
      if (fullName && r.solicitante_nombre && r.solicitante_nombre.trim().toLowerCase() === fullName.trim().toLowerCase()) return true;
      return false;
    });
  }, [requirements, esAdmin, verTodosAdmin, uid]);

  // Cantidad de aclaratorias pendientes por responder
  const totalAclaratorias = useMemo(() => {
    return requirementsFiltradas.filter((r) => r.status === 'aclaratoria_solicitada').length;
  }, [requirementsFiltradas]);

  const inp = {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: 14,
  };

  return (
    <Screen>
      <ConfigBanner />

      {/* ── Switcher de Pestañas ────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: colors.surface,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 3,
          marginBottom: spacing.md,
        }}
      >
        <TouchableOpacity
          onPress={() => setTab('nueva')}
          activeOpacity={0.8}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 10,
            borderRadius: radius.pill,
            backgroundColor: tab === 'nueva' ? colors.brand : 'transparent',
          }}
        >
          <Text style={{ fontSize: 16 }}>🔍</Text>
          <Text
            style={{
              color: tab === 'nueva' ? colors.brandContrast : colors.text,
              fontWeight: '800',
              fontSize: 13,
            }}
          >
            Pedir Material / Repuesto
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setTab('mis_solicitudes')}
          activeOpacity={0.8}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 10,
            borderRadius: radius.pill,
            backgroundColor: tab === 'mis_solicitudes' ? colors.brand : 'transparent',
          }}
        >
          <Text style={{ fontSize: 16 }}>📋</Text>
          <Text
            style={{
              color: tab === 'mis_solicitudes' ? colors.brandContrast : colors.text,
              fontWeight: '800',
              fontSize: 13,
            }}
          >
            Mis Solicitudes
          </Text>
          {totalAclaratorias > 0 && (
            <View
              style={{
                backgroundColor: '#EA580C',
                borderRadius: radius.pill,
                paddingHorizontal: 6,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                {totalAclaratorias}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* VISTA 1: PEDIR MATERIAL / REPUESTO                                     */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'nueva' && (
        <View style={{ gap: spacing.md }}>
          {/* Alerta de Aclaratoria Técnica pendiente si la hubiera */}
          {totalAclaratorias > 0 && (
            <TouchableOpacity
              onPress={() => setTab('mis_solicitudes')}
              activeOpacity={0.8}
              style={{
                backgroundColor: '#FFEDD5',
                borderWidth: 1.5,
                borderColor: '#EA580C',
                borderRadius: radius.md,
                padding: spacing.sm,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <Text style={{ fontSize: 22 }}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#9A3412', fontWeight: '800', fontSize: 13 }}>
                  Tienes {totalAclaratorias} aclaratoria(s) técnica(s) pendiente(s) de Compras
                </Text>
                <Text style={{ color: '#C2410C', fontSize: 11, marginTop: 1 }}>
                  El proveedor solicitó más medidas o especificaciones. Toca para ver y responder.
                </Text>
              </View>
              <Text style={{ color: '#EA580C', fontWeight: '800', fontSize: 13 }}>Ver ›</Text>
            </TouchableOpacity>
          )}

          {/* PASO 1: Destino y Solicitante */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>
              1. ¿Para qué equipo o área es el repuesto?
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Identifica la máquina o destino para asignarle el historial de mantenimiento y gasto.
            </Text>

            {/* Selector de Destino: Maquinaria / Vehículo / Área */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.sm }}>
              {[
                { key: 'maquinaria', label: '🚜 Maquinaria' },
                { key: 'vehiculo', label: '🚗 Vehículo' },
                { key: 'area', label: '🏢 Área / Taller' },
              ].map((d) => {
                const sel = destinoTipo === d.key;
                return (
                  <TouchableOpacity
                    key={d.key}
                    onPress={() => setDestinoTipo(d.key as any)}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      alignItems: 'center',
                      borderRadius: radius.md,
                      backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: sel ? colors.brand : colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color: sel ? colors.brandContrast : colors.text,
                        fontWeight: '700',
                        fontSize: 12,
                      }}
                    >
                      {d.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Selector según el tipo */}
            {destinoTipo === 'maquinaria' && (
              <View style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    Selecciona una o más Máquinas ({selectedMachineryIds.length} seleccionada{selectedMachineryIds.length === 1 ? '' : 's'}):
                  </Text>
                  {selectedMachineryIds.length > 0 && (
                    <TouchableOpacity onPress={() => setSelectedMachineryIds([])} style={{ padding: 2 }}>
                      <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>
                        ✕ Limpiar selección
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Resumen de maquinarias seleccionadas con código, placa y botón de remover */}
                {selectedMachineryIds.length > 0 && (
                  <View
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderRadius: radius.md,
                      padding: spacing.xs,
                      paddingHorizontal: spacing.sm,
                      borderLeftWidth: 3,
                      borderLeftColor: colors.brand,
                      marginBottom: 8,
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>
                      🚜 Destinos elegidos para la solicitud:
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {selectedMachineryIds.map((id) => {
                        const m = machines.find((x) => x.id === id);
                        if (!m) return null;
                        return (
                          <View
                            key={m.id}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.brand,
                              borderRadius: radius.pill,
                              paddingVertical: 3,
                              paddingHorizontal: 8,
                              gap: 6,
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>
                              🚜 {m.code} · {placaSerial(m)}
                            </Text>
                            <TouchableOpacity
                              onPress={() => toggleMachinery(m.id)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 11 }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Buscador de maquinarias por código, placa, marca o modelo */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <TextInput
                    value={machineryQuery}
                    onChangeText={setMachineryQuery}
                    placeholder="🔍 Buscar máquina por código, placa, marca o tipo…"
                    placeholderTextColor={colors.muted}
                    style={[inp, { flex: 1, paddingVertical: 6, paddingHorizontal: spacing.sm, fontSize: 12.5, borderRadius: radius.sm }]}
                  />
                  {machineryQuery ? (
                    <TouchableOpacity onPress={() => setMachineryQuery('')} style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>✕ Limpiar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {machinesFiltradas.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, paddingVertical: 4, fontStyle: 'italic' }}>
                    No se encontró ninguna maquinaria que coincida con "{machineryQuery}".
                  </Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                    {machinesFiltradas.map((m) => {
                      const sel = selectedMachineryIds.includes(m.id);
                      return (
                        <TouchableOpacity
                          key={m.id}
                          onPress={() => toggleMachinery(m.id)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            borderRadius: radius.pill,
                            backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                            borderWidth: 1.5,
                            borderColor: sel ? colors.brand : colors.border,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Text
                            style={{
                              color: sel ? colors.brandContrast : colors.text,
                              fontWeight: '700',
                              fontSize: 12,
                            }}
                          >
                            {sel ? '✓' : '＋'} 🚜 {m.code} · {placaSerial(m)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}

            {destinoTipo === 'vehiculo' && (
              <View style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    Selecciona uno o más Vehículos ({selectedVehicleIds.length} seleccionado{selectedVehicleIds.length === 1 ? '' : 's'}):
                  </Text>
                  {selectedVehicleIds.length > 0 && (
                    <TouchableOpacity onPress={() => setSelectedVehicleIds([])} style={{ padding: 2 }}>
                      <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>
                        ✕ Limpiar selección
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Resumen de vehículos seleccionados */}
                {selectedVehicleIds.length > 0 && (
                  <View
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderRadius: radius.md,
                      padding: spacing.xs,
                      paddingHorizontal: spacing.sm,
                      borderLeftWidth: 3,
                      borderLeftColor: colors.brand,
                      marginBottom: 8,
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>
                      🚗 Vehículos elegidos para la solicitud:
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {selectedVehicleIds.map((id) => {
                        const v = vehicles.find((x) => x.id === id);
                        if (!v) return null;
                        return (
                          <View
                            key={v.id}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.brand,
                              borderRadius: radius.pill,
                              paddingVertical: 3,
                              paddingHorizontal: 8,
                              gap: 6,
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>
                              🚗 {v.plate} ({[v.brand, v.model].filter(Boolean).join(' ') || 'Vehículo'})
                            </Text>
                            <TouchableOpacity
                              onPress={() => toggleVehicle(v.id)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 11 }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Buscador de vehículos */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <TextInput
                    value={vehicleQuery}
                    onChangeText={setVehicleQuery}
                    placeholder="🔍 Buscar vehículo por placa, marca o modelo…"
                    placeholderTextColor={colors.muted}
                    style={[inp, { flex: 1, paddingVertical: 6, paddingHorizontal: spacing.sm, fontSize: 12.5, borderRadius: radius.sm }]}
                  />
                  {vehicleQuery ? (
                    <TouchableOpacity onPress={() => setVehicleQuery('')} style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>✕ Limpiar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {vehiclesFiltrados.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, paddingVertical: 4, fontStyle: 'italic' }}>
                    No se encontró ningún vehículo con esa búsqueda.
                  </Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                    {vehiclesFiltrados.map((v) => {
                      const sel = selectedVehicleIds.includes(v.id);
                      return (
                        <TouchableOpacity
                          key={v.id}
                          onPress={() => toggleVehicle(v.id)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            borderRadius: radius.pill,
                            backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                            borderWidth: 1.5,
                            borderColor: sel ? colors.brand : colors.border,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Text
                            style={{
                              color: sel ? colors.brandContrast : colors.text,
                              fontWeight: '700',
                              fontSize: 12,
                            }}
                          >
                            {sel ? '✓' : '＋'} 🚗 {v.plate} ({[v.brand, v.model].filter(Boolean).join(' ') || 'Vehículo'})
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}

            {destinoTipo === 'area' && (
              <View style={{ marginBottom: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 3 }}>
                  Área o Departamento:
                </Text>
                <TextInput
                  value={areaTexto}
                  onChangeText={(t) => setAreaTexto(t.toUpperCase())}
                  placeholder="Ej: TALLER MECÁNICO, PLANTA, CANTERA…"
                  placeholderTextColor={colors.muted}
                  style={inp}
                />
              </View>
            )}

            {/* Solicitante */}
            <View style={{ marginTop: spacing.xs }}>
              <PersonaNominaPicker
                titulo="Persona que Solicita"
                ayuda="Toma el nombre de la nómina o escribe el nombre si es contratista/externo."
                valor={solicitante}
                onElegir={setSolicitante}
                personas={personasNomina}
                contactos={contactosSimples}
                onGuardarContacto={guardarContacto}
              />
            </View>
          </Card>

          {/* PASO 2: Buscador de Existencias */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>
              2. Consulta de Existencias en Almacén
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Escribe el nombre del repuesto. El sistema te dirá si hay disponible en almacén o si
              debes solicitar su compra.
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Escribe el repuesto (ej: filtro de aceite, correa, rolinera, manguera)…"
                placeholderTextColor={colors.muted}
                style={[inp, { flex: 1, fontSize: 15 }]}
              />
              {query ? (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.md,
                  }}
                >
                  <Text style={{ color: colors.muted, fontWeight: '700' }}>✕ Limpiar</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Resultados de búsqueda */}
            {query.trim().length > 0 && (
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>
                  Resultados en Almacén ({productosFiltrados.length}):
                </Text>

                {productosFiltrados.length === 0 ? (
                  <View
                    style={{
                      padding: spacing.md,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 26, marginBottom: 4 }}>🔍</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                      No se encontró "{query}" en el inventario
                    </Text>
                    <Text
                      style={{
                        color: colors.muted,
                        fontSize: 12,
                        textAlign: 'center',
                        marginTop: 2,
                        marginBottom: spacing.md,
                      }}
                    >
                      Es un repuesto no registrado o nuevo. Puedes solicitar su compra técnica de
                      inmediato.
                    </Text>

                    <TouchableOpacity
                      onPress={() => abrirPedirCompra(null)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        backgroundColor: colors.brand,
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.sm,
                        borderRadius: radius.md,
                      }}
                    >
                      <Text style={{ fontSize: 16 }}>🛒</Text>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
                        Solicitar Compra de "{query}"
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  productosFiltrados.map((item) => {
                    const tieneStock = (item.stock || 0) > 0;
                    return (
                      <View
                        key={item.id}
                        style={{
                          padding: spacing.md,
                          borderRadius: radius.md,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: tieneStock ? '#10B981' : colors.border,
                          gap: 6,
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <View style={{ flex: 1, paddingRight: spacing.sm }}>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                              {item.name}
                            </Text>
                            {item.sku ? (
                              <Text style={{ color: colors.muted, fontSize: 11 }}>SKU: {item.sku}</Text>
                            ) : null}
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            {tieneStock ? (
                              <View
                                style={{
                                  backgroundColor: '#DCFCE7',
                                  paddingHorizontal: 8,
                                  paddingVertical: 3,
                                  borderRadius: radius.pill,
                                }}
                              >
                                <Text style={{ color: '#16A34A', fontSize: 11, fontWeight: '800' }}>
                                  🟢 Stock: {qtyFmt(item.stock)} {item.unit || 'UND'}
                                </Text>
                              </View>
                            ) : (
                              <View
                                style={{
                                  backgroundColor: '#FEE2E2',
                                  paddingHorizontal: 8,
                                  paddingVertical: 3,
                                  borderRadius: radius.pill,
                                }}
                              >
                                <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '800' }}>
                                  🔴 Sin Existencia (0)
                                </Text>
                              </View>
                            )}
                            {(() => {
                              const enCart = cartItems.find((c) => c.tipo === 'stock' && c.itemId === item.id);
                              if (!enCart) return null;
                              return (
                                <View
                                  style={{
                                    backgroundColor: '#DBEAFE',
                                    paddingHorizontal: 8,
                                    paddingVertical: 2,
                                    borderRadius: radius.pill,
                                  }}
                                >
                                  <Text style={{ color: '#1E40AF', fontSize: 10.5, fontWeight: '800' }}>
                                    ✓ En tu lista: {qtyFmt(enCart.qty)} {item.unit || 'UND'}
                                  </Text>
                                </View>
                              );
                            })()}
                          </View>
                        </View>

                        {/* Botón según disponibilidad */}
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                          {tieneStock ? (() => {
                            const enCart = cartItems.find((c) => c.tipo === 'stock' && c.itemId === item.id);
                            return (
                              <TouchableOpacity
                                onPress={() => abrirPedirStock(item)}
                                style={{
                                  flex: 1,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 6,
                                  backgroundColor: enCart ? '#047857' : '#059669',
                                  paddingVertical: 9,
                                  borderRadius: radius.md,
                                }}
                              >
                                <Text style={{ fontSize: 15 }}>{enCart ? '➕' : '📦'}</Text>
                                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                                  {enCart
                                    ? `En tu lista (${qtyFmt(enCart.qty)}) · Ajustar o agregar más`
                                    : 'Solicitar de Almacén (Existencia)'}
                                </Text>
                              </TouchableOpacity>
                            );
                          })() : (
                            <TouchableOpacity
                              onPress={() => abrirPedirCompra(item)}
                              style={{
                                flex: 1,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                backgroundColor: colors.brand,
                                paddingVertical: 9,
                                borderRadius: radius.md,
                              }}
                            >
                              <Text style={{ fontSize: 15 }}>🛒</Text>
                              <Text
                                style={{
                                  color: colors.brandContrast,
                                  fontWeight: '800',
                                  fontSize: 13,
                                }}
                              >
                                Sin stock ➔ Solicitar Compra Técnica
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {/* Acceso directo a Compra si es un repuesto totalmente nuevo */}
            <View
              style={{
                marginTop: spacing.lg,
                paddingTop: spacing.md,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                  ¿Necesitas un repuesto nuevo o medida especial?
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Puedes llenar la solicitud técnica con foto y medidas para Compras.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => abrirPedirCompra(null)}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.brand,
                  paddingHorizontal: spacing.md,
                  paddingVertical: 8,
                  borderRadius: radius.md,
                }}
              >
                <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 12 }}>
                  ＋ Solicitar Compra
                </Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* PASO 3: Lista de Repuestos / Materiales a Solicitar (Carrito) */}
          <Card
            style={{
              borderColor: cartItems.length > 0 ? colors.brand : colors.border,
              borderWidth: cartItems.length > 0 ? 1.5 : 1,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                3. Repuestos y Materiales a Solicitar ({cartItems.length})
              </Text>
              {cartItems.length > 0 && (
                <TouchableOpacity onPress={() => setCartItems([])} style={{ padding: 4 }}>
                  <Text style={{ color: colors.danger, fontSize: 11.5, fontWeight: '700' }}>
                    🗑 Vaciar lista
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              {cartItems.length === 0
                ? 'Puedes pedir uno o más repuestos y se irán agregando aquí con la cantidad que necesitas.'
                : 'Revisa las cantidades antes de enviar la solicitud a Almacén o Compras.'}
            </Text>

            {cartItems.length === 0 ? (
              <View
                style={{
                  backgroundColor: colors.surfaceAlt,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: 24 }}>📋</Text>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                  Aún no has agregado ningún repuesto
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11.5, textAlign: 'center' }}>
                  Escribe en el buscador del paso 2 y presiona "Solicitar de Almacén" o "Solicitar Compra Técnica" para añadirlos aquí.
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {cartItems.map((item, idx) => {
                  const esStock = item.tipo === 'stock';
                  return (
                    <View
                      key={item.id}
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: esStock ? '#10B981' : colors.brand,
                        borderRadius: radius.md,
                        padding: spacing.sm,
                        gap: 6,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}
                      >
                        <View style={{ flex: 1, paddingRight: spacing.sm }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <View
                              style={{
                                backgroundColor: esStock ? '#DCFCE7' : '#DBEAFE',
                                paddingHorizontal: 6,
                                paddingVertical: 1,
                                borderRadius: radius.pill,
                              }}
                            >
                              <Text
                                style={{
                                  color: esStock ? '#166534' : '#1E40AF',
                                  fontSize: 10,
                                  fontWeight: '800',
                                }}
                              >
                                {esStock ? '📦 ALMACÉN' : '🛒 COMPRA TÉCNICA'}
                              </Text>
                            </View>

                            {esStock && item.urgency ? (
                              <View
                                style={{
                                  backgroundColor: URGENCIA_CONFIG[item.urgency]?.bg || '#FEF3C7',
                                  paddingHorizontal: 6,
                                  paddingVertical: 1,
                                  borderRadius: radius.sm,
                                }}
                              >
                                <Text
                                  style={{
                                    color: URGENCIA_CONFIG[item.urgency]?.color || '#B45309',
                                    fontSize: 10,
                                    fontWeight: '700',
                                  }}
                                >
                                  {URGENCIA_CONFIG[item.urgency]?.icon} {URGENCIA_CONFIG[item.urgency]?.label}
                                </Text>
                              </View>
                            ) : null}
                          </View>

                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13.5 }}>
                            {idx + 1}. {item.name}
                          </Text>
                          {item.sku ? (
                            <Text style={{ color: colors.muted, fontSize: 11 }}>SKU: {item.sku}</Text>
                          ) : null}
                        </View>

                        <TouchableOpacity
                          onPress={() => quitarItemDelCarrito(item.id)}
                          style={{
                            backgroundColor: '#FEE2E2',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: radius.sm,
                          }}
                        >
                          <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '800' }}>
                            🗑 Quitar
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {esStock && item.stockDisponible !== undefined ? (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          Stock disponible en almacén: {qtyFmt(item.stockDisponible)} {item.unit}
                          {item.qty > item.stockDisponible ? (
                            <Text style={{ color: '#DC2626', fontWeight: '700' }}>
                              {' '}(⚠️ Supera el stock actual)
                            </Text>
                          ) : null}
                        </Text>
                      ) : null}

                      {!esStock && item.medidas ? (
                        <View style={{ backgroundColor: '#EFF6FF', padding: 6, borderRadius: radius.sm }}>
                          <Text style={{ color: '#1E40AF', fontSize: 11, fontWeight: '700' }}>
                            📐 Medidas/Specs: <Text style={{ fontWeight: '400' }}>{item.medidas}</Text>
                          </Text>
                        </View>
                      ) : null}

                      {!esStock && (item.proveedorSugerido?.nombre || item.proveedorSugerido?.telefono) ? (
                        <View style={{ backgroundColor: '#F0FDF4', padding: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: '#BBF7D0' }}>
                          <Text style={{ color: '#166534', fontSize: 11, fontWeight: '700' }}>
                            🏬 Prov. sugerido: <Text style={{ fontWeight: '500' }}>{item.proveedorSugerido.nombre || 'Sin nombre'}{item.proveedorSugerido.telefono ? ` · Tel: ${item.proveedorSugerido.telefono}` : ''}{item.proveedorSugerido.direccion ? ` · Dir: ${item.proveedorSugerido.direccion}` : ''}</Text>
                          </Text>
                        </View>
                      ) : null}

                      {item.reason ? (
                        <Text style={{ color: colors.brandText, fontSize: 11, fontStyle: 'italic' }}>
                          Motivo / Falla: {item.reason}
                        </Text>
                      ) : null}

                      {/* Control de cantidad */}
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: colors.surfaceAlt,
                          padding: 6,
                          borderRadius: radius.sm,
                        }}
                      >
                        <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                          Cantidad requerida:
                        </Text>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <TouchableOpacity
                            onPress={() => cambiarCantidadCarrito(item.id, -1)}
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              width: 28,
                              height: 28,
                              borderRadius: radius.sm,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>-</Text>
                          </TouchableOpacity>

                          <TextInput
                            value={String(item.qty)}
                            onChangeText={(t) => setCantidadDirecta(item.id, t)}
                            keyboardType="numeric"
                            inputMode="decimal"
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              color: colors.text,
                              borderRadius: radius.sm,
                              paddingVertical: 2,
                              paddingHorizontal: 8,
                              width: 60,
                              textAlign: 'center',
                              fontWeight: '800',
                              fontSize: 13,
                            }}
                          />

                          <TouchableOpacity
                            onPress={() => cambiarCantidadCarrito(item.id, 1)}
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              width: 28,
                              height: 28,
                              borderRadius: radius.sm,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>+</Text>
                          </TouchableOpacity>

                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                            {item.unit}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}

                {/* Resumen del envío y botón principal */}
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    marginTop: spacing.xs,
                    gap: 6,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                    📋 Resumen de la Solicitud:
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    • Total de repuestos:{' '}
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{cartItems.length}</Text> (
                    {cartItems.filter((x) => x.tipo === 'stock').length} de almacén,{' '}
                    {cartItems.filter((x) => x.tipo === 'compra').length} de compras)
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    • Destino:{' '}
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {destinoTipo === 'maquinaria'
                        ? selectedMachineryIds.length > 0
                          ? `${selectedMachineryIds.length} maquinaria(s): ${machines
                              .filter((m) => selectedMachineryIds.includes(m.id))
                              .map((m) => `🚜 ${m.code} [${placaSerial(m)}]`)
                              .join(', ')}`
                          : '⚠️ Ninguna seleccionada'
                        : destinoTipo === 'vehiculo'
                        ? selectedVehicleIds.length > 0
                          ? `${selectedVehicleIds.length} vehículo(s): ${vehicles
                              .filter((v) => selectedVehicleIds.includes(v.id))
                              .map((v) => `🚗 ${v.plate}`)
                              .join(', ')}`
                          : '⚠️ Ninguno seleccionado'
                        : areaTexto.trim() || 'TALLER GENERAL'}
                    </Text>
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    • Para (Persona que solicita):{' '}
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {solicitante.nombre || 'Personal Taller'}
                    </Text>
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                    • Registrado automáticamente por:{' '}
                    <Text style={{ color: colors.brandText, fontWeight: '800' }}>
                      {fullName || 'Tu usuario'} (Tú)
                    </Text>
                  </Text>

                  <TouchableOpacity
                    onPress={enviarSolicitudCompleta}
                    disabled={submittingCart}
                    style={{
                      backgroundColor: '#059669',
                      paddingVertical: 13,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: spacing.sm,
                      opacity: submittingCart ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>
                      {submittingCart
                        ? 'Enviando solicitud…'
                        : `🚀 CONFIRMAR Y ENVIAR SOLICITUD (${cartItems.length} REPUESTOS)`}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </Card>
        </View>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* VISTA 2: MIS SOLICITUDES (SEGUIMIENTO Y ACLARATORIAS)                  */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'mis_solicitudes' && (
        <View style={{ gap: spacing.md }}>
          {/* Selector para Administradores: Mis Pedidos vs Todos los Pedidos */}
          {esAdmin && (
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: colors.surface,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 3,
                marginBottom: spacing.xs,
              }}
            >
              <TouchableOpacity
                onPress={() => setVerTodosAdmin(false)}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  backgroundColor: !verTodosAdmin ? colors.brand : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: !verTodosAdmin ? colors.brandContrast : colors.text,
                    fontWeight: '800',
                    fontSize: 12,
                  }}
                >
                  👤 Solo Mis Pedidos
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setVerTodosAdmin(true)}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  backgroundColor: verTodosAdmin ? colors.brand : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: verTodosAdmin ? colors.brandContrast : colors.text,
                    fontWeight: '800',
                    fontSize: 12,
                  }}
                >
                  🏢 Ver Todo (Admin)
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {esAdmin && verTodosAdmin
              ? 'Mostrando todos los pedidos de la empresa (modo administrador).'
              : 'Mostrando tus pedidos personales de existencia y solicitudes de compra técnica.'}
          </Text>

          {/* 1) Sección Aclaratorias Técnicas pendientes (Prioridad Máxima) */}
          {totalAclaratorias > 0 && (
            <Card style={{ borderColor: '#EA580C', borderWidth: 2, backgroundColor: '#FFF7ED' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs }}>
                <Text style={{ fontSize: 20 }}>⚠️</Text>
                <Text style={{ color: '#C2410C', fontWeight: '900', fontSize: 14 }}>
                  ACLARATORIAS TÉCNICAS REQUERIDAS POR COMPRAS ({totalAclaratorias})
                </Text>
              </View>
              <Text style={{ color: '#9A3412', fontSize: 12, marginBottom: spacing.sm }}>
                Compras se comunicó con el proveedor y requiere medidas adicionales para cerrar la compra:
              </Text>

              {requirementsFiltradas
                .filter((r) => r.status === 'aclaratoria_solicitada')
                .map((r) => {
                  return (
                    <View
                      key={r.id}
                      style={{
                        backgroundColor: colors.surface,
                        padding: spacing.md,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: '#FDBA74',
                        marginBottom: spacing.xs,
                        gap: 6,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontWeight: '800', color: colors.text, fontSize: 14 }}>
                          {r.code} · {r.title || 'Requerimiento de compra'}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{dmyOf(r.created_at)}</Text>
                      </View>

                      <View
                        style={{
                          backgroundColor: '#FFEDD5',
                          padding: spacing.sm,
                          borderRadius: radius.sm,
                        }}
                      >
                        <Text style={{ color: '#9A3412', fontWeight: '700', fontSize: 12 }}>
                          Pregunta de Compras ({r.aclaratoria_solicitada_por || 'Compras'}):
                        </Text>
                        <Text style={{ color: '#7C2D12', fontSize: 13, marginTop: 2, fontStyle: 'italic' }}>
                          "{r.aclaratoria_motivo}"
                        </Text>
                      </View>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        <TouchableOpacity
                          onPress={() => abrirResponderAclaratoria(r)}
                          style={{
                            flex: 2,
                            minWidth: 200,
                            backgroundColor: '#EA580C',
                            paddingVertical: 9,
                            paddingHorizontal: 12,
                            borderRadius: radius.md,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                            ✏️ Responder medidas y especificaciones
                          </Text>
                        </TouchableOpacity>

                        {puedeCancelarSolicitudCompra(r, uid, fullName, esAdmin).ok && (
                          <TouchableOpacity
                            onPress={() =>
                              abrirModalCancelar({
                                tipo: 'compra',
                                ids: [r.id],
                                codigo: r.code || 'REQ',
                                titulo: r.title || 'Solicitud de Compra Técnica',
                                reqCompra: r,
                              })
                            }
                            style={{
                              flex: 1,
                              minWidth: 150,
                              backgroundColor: scheme === 'dark' ? 'rgba(239,68,68,0.16)' : '#FEF2F2',
                              borderWidth: 1.5,
                              borderColor: scheme === 'dark' ? '#F87171' : '#FCA5A5',
                              paddingVertical: 9,
                              paddingHorizontal: 12,
                              borderRadius: radius.md,
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexDirection: 'row',
                              gap: 5,
                            }}
                          >
                            <Text style={{ fontSize: 12 }}>🚫</Text>
                            <Text style={{ color: scheme === 'dark' ? '#FCA5A5' : '#DC2626', fontWeight: '800', fontSize: 12 }}>
                              Cancelar solicitud
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
            </Card>
          )}

          {/* 2) Solicitudes de Despacho de Almacén (Existencias Consolidadas por Pedido) */}
          <SectionTitle>📦 Pedidos de Despacho al Almacén ({gruposStockFiltrados.length})</SectionTitle>

          {/* Barra de control para desplegar / plegar todas */}
          {gruposStockFiltrados.length > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                {gruposStockFiltrados.length} {gruposStockFiltrados.length === 1 ? 'pedido consolidado' : 'pedidos consolidados'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={expandirTodosStock}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: radius.sm,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                    📂 Desplegar todas
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={plegarTodosStock}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: radius.sm,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                    📁 Plegar todas
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {gruposStockFiltrados.length === 0 ? (
            <EmptyState
              title="Sin pedidos de almacén"
              subtitle="No hay solicitudes de existencia registradas por tu usuario."
            />
          ) : (
            gruposStockFiltrados.map((grupo) => {
              const est = grupo.todoCanceladoPorUsuario
                ? ESTADO_GRUPO_CONFIG.cancelado
                : (ESTADO_GRUPO_CONFIG as any)[grupo.estadoGrupo] || ESTADO_GRUPO_CONFIG.pendiente;
              const urg = (URGENCIA_CONFIG as any)[grupo.urgencyMax || 'normal'] || URGENCIA_CONFIG.normal;
              const mach = grupo.machinery_id ? machines.find((m) => m.id === grupo.machinery_id) : null;
              const veh = grupo.vehicle_id ? vehicles.find((v) => v.id === grupo.vehicle_id) : null;
              const permCancelarGrupo = puedeCancelarSolicitudStock(grupo, uid, fullName, esAdmin);

              const isOpenDefault = grupo.estadoGrupo === 'pendiente' || grupo.estadoGrupo === 'parcial';
              const isAbierto = expandidosStock[grupo.id] !== undefined ? expandidosStock[grupo.id] : isOpenDefault;

              return (
                <Card key={grupo.id} style={{ gap: 8, borderColor: est.color, borderWidth: 1.5 }}>
                  {/* Cabecera del pedido consolidado y toggle plegar/desplegar */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => toggleExpandStock(grupo.id, isOpenDefault)}
                      activeOpacity={0.7}
                      style={{ flex: 1, minWidth: 200 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={{ fontWeight: '900', fontSize: 15, color: colors.text }}>
                          {grupo.codigoLote}
                        </Text>
                        <View
                          style={{
                            backgroundColor: colors.surfaceAlt,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: radius.pill,
                          }}
                        >
                          <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 11 }}>
                            {grupo.totalItems} {grupo.totalItems === 1 ? 'repuesto' : 'repuestos'}
                          </Text>
                        </View>
                        <View style={{ backgroundColor: urg.bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm }}>
                          <Text style={{ color: urg.color, fontSize: 10.5, fontWeight: '700' }}>
                            Urgencia {urg.label}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                        Fecha de solicitud: {dmyOf(grupo.fechaCreacion)}
                      </Text>
                    </TouchableOpacity>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View
                        style={{
                          backgroundColor: est.bg,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: radius.pill,
                        }}
                      >
                        <Text style={{ color: est.color, fontWeight: '800', fontSize: 12 }}>
                          {est.icon} {est.label}
                        </Text>
                      </View>

                      <TouchableOpacity
                        onPress={() => toggleExpandStock(grupo.id, isOpenDefault)}
                        activeOpacity={0.7}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          backgroundColor: isAbierto ? colors.surfaceAlt : (colors as any).brandLight || '#EFF6FF',
                          paddingHorizontal: 9,
                          paddingVertical: 4,
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          borderColor: isAbierto ? colors.border : '#93C5FD',
                        }}
                      >
                        <Text style={{ fontSize: 11.5, fontWeight: '800', color: isAbierto ? colors.muted : '#1D4ED8' }}>
                          {isAbierto ? '▲ Plegar' : `▼ Desplegar (${grupo.totalItems})`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Destino con Código + PLACA obligatoria (Regla de Maquinaria) */}
                  <View
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      padding: spacing.xs,
                      paddingHorizontal: spacing.sm,
                      borderRadius: radius.sm,
                      gap: 2,
                    }}
                  >
                    {mach ? (
                      <Text style={{ color: colors.text, fontSize: 12 }}>
                        🚜 <Text style={{ fontWeight: '700' }}>Destino:</Text>{' '}
                        <Text style={{ fontWeight: '800' }}>{mach.code}</Text> ·{' '}
                        <Text style={{ fontWeight: '800' }}>{placaSerial(mach)}</Text>
                        {mach.tipo ? ` (${mach.tipo})` : ''}
                      </Text>
                    ) : veh ? (
                      <Text style={{ color: colors.text, fontSize: 12 }}>
                        🚗 <Text style={{ fontWeight: '700' }}>Destino:</Text> Placa:{' '}
                        <Text style={{ fontWeight: '800' }}>{veh.plate}</Text>{' '}
                        ({[veh.brand, veh.model].filter(Boolean).join(' ') || 'Vehículo'})
                      </Text>
                    ) : (
                      <Text style={{ color: colors.text, fontSize: 12 }}>
                        🏢 <Text style={{ fontWeight: '700' }}>Destino:</Text>{' '}
                        <Text style={{ fontWeight: '800' }}>{grupo.area || 'TALLER / GENERAL'}</Text>
                      </Text>
                    )}

                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                      👷 <Text style={{ fontWeight: '700' }}>Persona que solicita (físico):</Text>{' '}
                      <Text style={{ color: colors.text, fontWeight: '800' }}>
                        {grupo.solicitanteNombre}
                      </Text>
                    </Text>
                  </View>

                  {/* Vista rápida si está plegada */}
                  {!isAbierto && (
                    <TouchableOpacity
                      onPress={() => toggleExpandStock(grupo.id, isOpenDefault)}
                      activeOpacity={0.7}
                      style={{
                        backgroundColor: colors.surfaceAlt,
                        padding: spacing.xs,
                        paddingHorizontal: spacing.sm,
                        borderRadius: radius.sm,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: colors.muted, fontSize: 11.5, flex: 1, paddingRight: 6 }}>
                        📦 <Text style={{ fontWeight: '800', color: colors.text }}>{grupo.totalItems}</Text> {grupo.totalItems === 1 ? 'repuesto' : 'repuestos'}: {grupo.items.map((i) => i.item_name).slice(0, 3).join(', ')}{grupo.items.length > 3 ? '…' : ''}
                      </Text>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>
                        Toca para desplegar ▾
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Detalle desplegable de repuestos y estado */}
                  {isAbierto && (
                    <>
                      {/* Lista de Artículos de esta Orden */}
                      <View style={{ gap: 6, marginTop: 2 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Artículos solicitados en este pedido:
                        </Text>

                        {grupo.items.map((s, idx) => {
                          const rej = parseRejectionNote(s.rejection_note);
                          const esItemCancelado = s.status === 'rechazado' && Boolean(rej.isCancelled);
                          const itemEst = esItemCancelado
                            ? ESTADO_EXISTENCIA_CONFIG.cancelado
                            : (ESTADO_EXISTENCIA_CONFIG as any)[s.status] || ESTADO_EXISTENCIA_CONFIG.pendiente;
                          const puedeCancelarItem = puedeCancelarSolicitudStock(s, uid, fullName, esAdmin).ok;

                          return (
                            <View
                              key={s.id}
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor:
                                  s.status === 'despachado'
                                    ? '#86EFAC'
                                    : esItemCancelado
                                      ? '#94A3B8'
                                      : s.status === 'rechazado'
                                        ? '#FCA5A5'
                                        : colors.border,
                                borderRadius: radius.md,
                                padding: spacing.sm,
                                gap: 4,
                              }}
                            >
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ fontWeight: '800', fontSize: 13, color: colors.text, flex: 1, paddingRight: 6 }}>
                                  {idx + 1}. {s.item_name}
                                </Text>
                                <View
                                  style={{
                                    backgroundColor: itemEst.bg,
                                    paddingHorizontal: 7,
                                    paddingVertical: 2,
                                    borderRadius: radius.pill,
                                  }}
                                >
                                  <Text style={{ color: itemEst.color, fontWeight: '800', fontSize: 10.5 }}>
                                    {itemEst.icon} {itemEst.label}
                                  </Text>
                                </View>
                              </View>

                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                <Text style={{ color: colors.muted, fontSize: 12 }}>
                                  Cantidad: <Text style={{ color: colors.text, fontWeight: '800' }}>{qtyFmt(s.qty)} {s.unit || 'UND'}</Text>
                                  <Text style={{ color: colors.muted, fontSize: 10.5 }}> · Ticket {s.code}</Text>
                                </Text>

                                {puedeCancelarItem && (
                                  <TouchableOpacity
                                    onPress={() =>
                                      abrirModalCancelar({
                                        tipo: 'stock_item',
                                        ids: [s.id],
                                        codigo: s.code || grupo.codigoLote,
                                        titulo: `${s.item_name} (${qtyFmt(s.qty)} ${s.unit || 'UND'})`,
                                      })
                                    }
                                    activeOpacity={0.75}
                                    style={{
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      gap: 4,
                                      backgroundColor: scheme === 'dark' ? 'rgba(239,68,68,0.16)' : '#FEF2F2',
                                      borderWidth: 1,
                                      borderColor: scheme === 'dark' ? '#F87171' : '#FECACA',
                                      paddingHorizontal: 9,
                                      paddingVertical: 4,
                                      borderRadius: radius.sm,
                                    }}
                                  >
                                    <Text style={{ fontSize: 11 }}>🚫</Text>
                                    <Text style={{ color: scheme === 'dark' ? '#FCA5A5' : '#DC2626', fontWeight: '800', fontSize: 11 }}>
                                      {grupo.totalItems > 1 ? 'Cancelar este repuesto' : 'Cancelar solicitud'}
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>

                              {s.cleanReason ? (
                                <Text style={{ color: colors.brandText, fontSize: 11, fontStyle: 'italic' }}>
                                  Nota: {s.cleanReason}
                                </Text>
                              ) : null}

                              {s.status === 'despachado' && (
                                <Text style={{ color: '#15803D', fontSize: 11, fontWeight: '700' }}>
                                  ✅ Despachado por {s.dispatched_by_name || 'Almacenista'}{s.dispatched_at ? ` el ${dmyTimeOf(s.dispatched_at)}` : ''}
                                </Text>
                              )}

                              {s.status === 'rechazado' && (
                                <View
                                  style={{
                                    backgroundColor: esItemCancelado
                                      ? (scheme === 'dark' ? 'rgba(100,116,139,0.18)' : '#F1F5F9')
                                      : '#FEE2E2',
                                    borderLeftWidth: 3,
                                    borderLeftColor: esItemCancelado ? '#64748B' : '#DC2626',
                                    padding: spacing.xs,
                                    paddingHorizontal: spacing.sm,
                                    borderRadius: radius.sm,
                                    marginTop: 2,
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: esItemCancelado
                                        ? (scheme === 'dark' ? '#E2E8F0' : '#334155')
                                        : '#991B1B',
                                      fontSize: 11,
                                      fontWeight: '700',
                                    }}
                                  >
                                    {esItemCancelado
                                      ? `🚫 Cancelada por ${rej.rejectedBy || 'Solicitante'}${rej.rejectedAt ? ` (${rej.rejectedAt})` : ''}: ${rej.note || 'Cancelada por el solicitante'}`
                                      : `❌ Rechazado por ${rej.rejectedBy || 'Almacén'}: ${rej.note || 'Sin motivo'}`}
                                  </Text>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>

                      {/* Resumen al pie del grupo */}
                      {grupo.estadoGrupo === 'despachado' && (
                        <View
                          style={{
                            backgroundColor: '#DCFCE7',
                            borderWidth: 1,
                            borderColor: '#86EFAC',
                            padding: spacing.xs,
                            paddingHorizontal: spacing.sm,
                            borderRadius: radius.sm,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <Text style={{ fontSize: 14 }}>✅</Text>
                          <Text style={{ color: '#166534', fontWeight: '800', fontSize: 11.5 }}>
                            Todos los artículos de esta orden fueron despachados y entregados.
                          </Text>
                        </View>
                      )}

                      {grupo.estadoGrupo === 'parcial' && (
                        <View
                          style={{
                            backgroundColor: '#EFF6FF',
                            borderWidth: 1,
                            borderColor: '#BFDBFE',
                            padding: spacing.xs,
                            paddingHorizontal: spacing.sm,
                            borderRadius: radius.sm,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <Text style={{ fontSize: 14 }}>🔄</Text>
                          <Text style={{ color: '#1E40AF', fontWeight: '800', fontSize: 11.5 }}>
                            Entrega parcial: {grupo.despachados} de {grupo.totalItems} artículos despachados.
                          </Text>
                        </View>
                      )}

                      {grupo.estadoGrupo === 'pendiente' && (
                        <View
                          style={{
                            backgroundColor: '#FEF3C7',
                            borderWidth: 1,
                            borderColor: '#FDE68A',
                            padding: spacing.xs,
                            paddingHorizontal: spacing.sm,
                            borderRadius: radius.sm,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <Text style={{ fontSize: 14 }}>⏳</Text>
                          <Text style={{ color: '#92400E', fontWeight: '700', fontSize: 11.5 }}>
                            En espera de revisión y entrega física por el Almacén.
                          </Text>
                        </View>
                      )}

                      {grupo.estadoGrupo === 'rechazado' && (
                        <View
                          style={{
                            backgroundColor: grupo.todoCanceladoPorUsuario
                              ? (scheme === 'dark' ? 'rgba(100,116,139,0.18)' : '#F1F5F9')
                              : '#FEE2E2',
                            borderWidth: 1,
                            borderColor: grupo.todoCanceladoPorUsuario ? '#94A3B8' : '#F87171',
                            padding: spacing.xs,
                            paddingHorizontal: spacing.sm,
                            borderRadius: radius.sm,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <Text style={{ fontSize: 14 }}>{grupo.todoCanceladoPorUsuario ? '🚫' : '❌'}</Text>
                          <Text
                            style={{
                              color: grupo.todoCanceladoPorUsuario
                                ? (scheme === 'dark' ? '#E2E8F0' : '#334155')
                                : '#991B1B',
                              fontWeight: '800',
                              fontSize: 11.5,
                            }}
                          >
                            {grupo.todoCanceladoPorUsuario
                              ? 'Esta solicitud fue cancelada por el solicitante.'
                              : 'Todos los artículos de esta orden fueron rechazados.'}
                          </Text>
                        </View>
                      )}
                    </>
                  )}

                  {/* Botón de cancelación a nivel de pedido (visible plegado o desplegado cuando hay pendientes) */}
                  {permCancelarGrupo.ok && grupo.pendientesCount > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 }}>
                      <TouchableOpacity
                        onPress={() => {
                          const pendientes = grupo.items.filter((i: any) => i.status === 'pendiente' && !i.movement_id);
                          abrirModalCancelar({
                            tipo: 'stock_grupo',
                            ids: pendientes.map((i: any) => i.id),
                            codigo: grupo.codigoLote,
                            titulo:
                              pendientes.length === 1
                                ? `${pendientes[0].item_name} (${qtyFmt(pendientes[0].qty)} ${pendientes[0].unit || 'UND'})`
                                : `${pendientes.length} repuestos pendientes: ${pendientes.map((i: any) => i.item_name).slice(0, 3).join(', ')}${pendientes.length > 3 ? '…' : ''}`,
                          });
                        }}
                        activeOpacity={0.75}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          backgroundColor: scheme === 'dark' ? 'rgba(239,68,68,0.16)' : '#FEF2F2',
                          borderWidth: 1.5,
                          borderColor: scheme === 'dark' ? '#F87171' : '#FCA5A5',
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: radius.sm,
                        }}
                      >
                        <Text style={{ fontSize: 12 }}>🚫</Text>
                        <Text style={{ color: scheme === 'dark' ? '#FCA5A5' : '#DC2626', fontWeight: '800', fontSize: 12 }}>
                          {grupo.totalItems > 1
                            ? grupo.pendientesCount === grupo.totalItems
                              ? `Cancelar pedido completo (${grupo.pendientesCount})`
                              : `Cancelar pendientes (${grupo.pendientesCount})`
                            : 'Cancelar solicitud'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Card>
              );
            })
          )}

          {/* 3) Requerimientos de Compra (Técnicos) */}
          <SectionTitle>🛒 Solicitudes de Compra Técnica ({requirementsFiltradas?.length || 0})</SectionTitle>
          {requirementsFiltradas?.length === 0 ? (
            <EmptyState
              title="Sin solicitudes de compra"
              subtitle="No hay solicitudes de compra técnica registradas por tu usuario."
            />
          ) : (
            requirementsFiltradas.slice(0, 30).map((r) => {
              const est = ESTADO_COMPRA_CONFIG[r.status] || ESTADO_COMPRA_CONFIG.pendiente;
              const estadoDinamico = calcularEstadoRequerimiento(r);
              const fac = extraerFactura(r);
              const desp = extraerDespacho(r);
              const esRetirado = desp.estado === 'retirado';

              // Proveedor propuesto si lo hubiera en observaciones o notas
              const matchProv = (r.observaciones || '').match(/\[PROVEEDOR SUGERIDO(?:\s*\([^)]*\))?: Nombre:\s*([^|]+)\|\s*Tel:\s*([^|]+)\|\s*Dirección:\s*([^\]]+)\]/i);
              const provSugerido = matchProv ? {
                nombre: matchProv[1].trim() === 'No indicado' ? '' : matchProv[1].trim(),
                telefono: matchProv[2].trim() === 'No indicado' ? '' : matchProv[2].trim(),
                direccion: matchProv[3].trim() === 'No indicada' ? '' : matchProv[3].trim(),
              } : null;

              // Determinar la fase actual del Stepper (1: Solicitado, 2: Cotizando/Proveedor, 3: Aprobación/Pago, 4: En Almacén)
              const pasoActual = (() => {
                if (r.status === 'rechazado') return 0;
                if (r.status === 'recibido') return 4;
                if (r.status === 'esperando_recepcion' || estadoDinamico.codigo === 'esperando_recepcion') return 4;
                if (r.status === 'aprobado' || estadoDinamico.codigo === 'aprobado') return 3;
                if (estadoDinamico.codigo === 'esperando_pago' || estadoDinamico.codigo === 'esperando_aprobacion_gg') return 3;
                if (estadoDinamico.codigo === 'esperando_cotizacion' || estadoDinamico.codigo === 'esperando_proveedor' || r.supplier_id) return 2;
                return 1;
              })();

              return (
                <Card key={r.id} style={{ gap: 6, borderColor: estadoDinamico.color || est.color, borderWidth: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text, flex: 1, paddingRight: 6 }}>
                      {r.code} · {r.title || 'Requerimiento de compra'}
                    </Text>
                    <View
                      style={{
                        backgroundColor: estadoDinamico.bg || est.bg,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: radius.pill,
                      }}
                    >
                      <Text style={{ color: estadoDinamico.color || est.color, fontWeight: '800', fontSize: 11 }}>
                        {estadoDinamico.icon} {estadoDinamico.short || est.label}
                      </Text>
                    </View>
                  </View>

                  {/* ── Stepper de Seguimiento en Tiempo Real (Responsive Móvil y PC) ── */}
                  <View
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderRadius: radius.md,
                      padding: spacing.sm,
                      marginVertical: 4,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      {/* Paso 1: Solicitado */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: radius.pill,
                            backgroundColor: pasoActual >= 1 ? '#059669' : colors.muted,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>✓</Text>
                        </View>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: pasoActual >= 1 ? colors.text : colors.muted, marginTop: 2, textAlign: 'center' }}>
                          1. Solicitado
                        </Text>
                      </View>

                      {/* Línea 1-2 */}
                      <View style={{ height: 2, flex: 1, backgroundColor: pasoActual >= 2 ? '#059669' : colors.border, marginHorizontal: 2, marginBottom: 12 }} />

                      {/* Paso 2: Cotización */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: radius.pill,
                            backgroundColor: pasoActual > 2 ? '#059669' : pasoActual === 2 ? '#D97706' : colors.surface,
                            borderWidth: pasoActual < 2 ? 1.5 : 0,
                            borderColor: colors.muted,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: pasoActual >= 2 ? '#fff' : colors.muted, fontSize: 10, fontWeight: '800' }}>
                            {pasoActual > 2 ? '✓' : '2'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: pasoActual >= 2 ? (pasoActual === 2 ? '#D97706' : colors.text) : colors.muted, marginTop: 2, textAlign: 'center' }}>
                          2. Cotizado
                        </Text>
                      </View>

                      {/* Línea 2-3 */}
                      <View style={{ height: 2, flex: 1, backgroundColor: pasoActual >= 3 ? '#059669' : colors.border, marginHorizontal: 2, marginBottom: 12 }} />

                      {/* Paso 3: Aprobación / Pago */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: radius.pill,
                            backgroundColor: pasoActual > 3 ? '#059669' : pasoActual === 3 ? '#2563EB' : colors.surface,
                            borderWidth: pasoActual < 3 ? 1.5 : 0,
                            borderColor: colors.muted,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: pasoActual >= 3 ? '#fff' : colors.muted, fontSize: 10, fontWeight: '800' }}>
                            {pasoActual > 3 ? '✓' : '3'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: pasoActual >= 3 ? (pasoActual === 3 ? '#2563EB' : colors.text) : colors.muted, marginTop: 2, textAlign: 'center' }}>
                          3. Pago
                        </Text>
                      </View>

                      {/* Línea 3-4 */}
                      <View style={{ height: 2, flex: 1, backgroundColor: pasoActual >= 4 ? (esRetirado ? '#2563EB' : '#059669') : colors.border, marginHorizontal: 2, marginBottom: 12 }} />

                      {/* Paso 4: En Almacén / Retirado (Falta 3) */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: radius.pill,
                            backgroundColor: pasoActual === 4 ? (esRetirado ? '#2563EB' : '#059669') : colors.surface,
                            borderWidth: pasoActual < 4 ? 1.5 : 0,
                            borderColor: colors.muted,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: pasoActual === 4 ? '#fff' : colors.muted, fontSize: 10, fontWeight: '800' }}>
                            {pasoActual === 4 ? '✓' : '4'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: pasoActual === 4 ? (esRetirado ? '#2563EB' : '#059669') : colors.muted, marginTop: 2, textAlign: 'center' }}>
                          {pasoActual === 4 ? (esRetirado ? '4. Retirado' : '4. 🟢 Disponible') : '4. Almacén'}
                        </Text>
                      </View>
                    </View>

                    {/* Explicación en lenguaje claro del estatus en tiempo real */}
                    <View
                      style={{
                        backgroundColor: pasoActual === 4 ? (esRetirado ? '#DBEAFE' : '#DCFCE7') : estadoDinamico.bg,
                        paddingVertical: 5,
                        paddingHorizontal: 8,
                        borderRadius: radius.sm,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Text style={{ fontSize: 13 }}>
                        {pasoActual === 4 ? (esRetirado ? '📦' : '🟢') : estadoDinamico.icon}
                      </Text>
                      <Text style={{ color: pasoActual === 4 ? (esRetirado ? '#1E40AF' : '#15803D') : estadoDinamico.color, fontWeight: '800', fontSize: 11.5, flex: 1 }}>
                        {pasoActual === 4
                          ? (esRetirado
                              ? `Retirado de almacén por ${desp.retiradoPor || 'Personal'}${desp.fecha ? ` (${dmyOf(desp.fecha)})` : ''}`
                              : '🟢 ¡Disponible en almacén! Tu repuesto está listo para retiro en galpón')
                          : `Estatus en tiempo real: ${estadoDinamico.label}`}
                      </Text>
                    </View>
                  </View>

                  {/* Ficha de Proveedor Propuesto si existe */}
                  {provSugerido && (provSugerido.nombre || provSugerido.telefono) ? (
                    <View
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        padding: spacing.xs,
                        paddingHorizontal: spacing.sm,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 6,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 160 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>
                          🏬 Proveedor propuesto por ti: <Text style={{ color: colors.brandText }}>{provSugerido.nombre || 'Sin nombre'}</Text>
                        </Text>
                        {provSugerido.telefono ? (
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            📞 Tel: {provSugerido.telefono} {provSugerido.direccion ? `· 📍 ${provSugerido.direccion}` : ''}
                          </Text>
                        ) : null}
                      </View>
                      {provSugerido.telefono ? (
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          <TouchableOpacity
                            onPress={() => Linking.openURL(`tel:${provSugerido.telefono.replace(/\s+/g, '')}`)}
                            style={{ backgroundColor: '#DBEAFE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}
                          >
                            <Text style={{ color: '#1E40AF', fontSize: 10.5, fontWeight: '700' }}>📞 Llamar</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              const cleanTel = provSugerido.telefono.replace(/\D/g, '');
                              const numInt = cleanTel.startsWith('58') ? cleanTel : cleanTel.startsWith('0') ? '58' + cleanTel.slice(1) : cleanTel;
                              Linking.openURL(`https://wa.me/${numInt}`);
                            }}
                            style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}
                          >
                            <Text style={{ color: '#166534', fontSize: 10.5, fontWeight: '700' }}>💬 WhatsApp</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Fila de registro y auditoría */}
                  <View
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      padding: spacing.xs,
                      paddingHorizontal: spacing.sm,
                      borderRadius: radius.sm,
                      marginTop: 2,
                      gap: 2,
                    }}
                  >
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                      👷 <Text style={{ fontWeight: '700' }}>Persona que solicita (físico):</Text>{' '}
                      <Text style={{ color: colors.text, fontWeight: '800' }}>
                        {r.solicitante_nombre || 'Personal Taller'}
                      </Text>
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                      👤 <Text style={{ fontWeight: '700' }}>Registrado automáticamente por:</Text>{' '}
                      <Text style={{ color: colors.brandText, fontWeight: '800' }}>
                        {r.requested_by_name || (r.requested_by === uid ? `${fullName || 'Tu usuario'} (Tú)` : 'Usuario registrado')}
                      </Text>{' '}
                      el {dmyTimeOf(r.created_at)}
                    </Text>
                    {r.area ? (
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        🏢 <Text style={{ fontWeight: '700' }}>Área / Destino:</Text> {r.area}
                      </Text>
                    ) : null}
                  </View>

                  {/* Renglones */}
                  <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.sm, borderRadius: radius.sm, gap: 6 }}>
                    {(r.items || []).map((it, idx) => {
                      const puedeQuitarRenglon =
                        (r.items || []).length > 1 && puedeCancelarSolicitudCompra(r, uid, fullName, esAdmin).ok;
                      return (
                        <View
                          key={idx}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <View style={{ flex: 1, minWidth: 180 }}>
                            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                              • {it.name} ({qtyFmt(it.qty)} {it.unit || 'UND'})
                            </Text>
                            {it.note ? (
                              <Text style={{ color: colors.brandText, fontSize: 11, fontStyle: 'italic', marginLeft: 8 }}>
                                📐 Medidas/Specs: {it.note}
                              </Text>
                            ) : null}
                          </View>

                          {puedeQuitarRenglon && (
                            <TouchableOpacity
                              onPress={() =>
                                abrirModalCancelar({
                                  tipo: 'compra_renglon',
                                  ids: [r.id],
                                  codigo: `${r.code} · Renglón ${idx + 1}`,
                                  titulo: `${it.name} (${qtyFmt(it.qty)} ${it.unit || 'UND'})`,
                                  reqCompra: r,
                                  renglonIdx: idx,
                                })
                              }
                              style={{
                                backgroundColor: scheme === 'dark' ? 'rgba(239,68,68,0.16)' : '#FEF2F2',
                                borderWidth: 1,
                                borderColor: scheme === 'dark' ? '#F87171' : '#FECACA',
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                borderRadius: radius.sm,
                              }}
                            >
                              <Text style={{ color: scheme === 'dark' ? '#FCA5A5' : '#DC2626', fontSize: 10.5, fontWeight: '800' }}>
                                ✕ Cancelar renglón
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      Fecha solicitud: {dmyOf(r.created_at)}
                    </Text>
                    {r.attachment_url ? (
                      <Text style={{ color: colors.brand, fontSize: 11, fontWeight: '700' }}>
                        📷 Con foto adjunta
                      </Text>
                    ) : null}
                  </View>

                  {/* Cuadro de Aprobado */}
                  {(r.status === 'aprobado' || r.status === 'recibido') && (
                    <View
                      style={{
                        backgroundColor: '#DCFCE7',
                        borderWidth: 1.5,
                        borderColor: '#86EFAC',
                        padding: spacing.sm,
                        borderRadius: radius.md,
                        marginTop: 4,
                        gap: 2,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 15 }}>✅</Text>
                        <Text style={{ color: '#166534', fontWeight: '800', fontSize: 12 }}>
                          REQUERIMIENTO APROBADO PARA COMPRA
                        </Text>
                      </View>
                      <Text style={{ color: '#15803D', fontSize: 11.5, fontWeight: '700' }}>
                        Aprobado por: <Text style={{ color: '#166534', fontWeight: '800' }}>{r.decided_by_name || 'Gerencia / Compras'}</Text>
                      </Text>
                      {r.decided_at ? (
                        <Text style={{ color: '#166534', fontSize: 11 }}>
                          📅 Fecha y hora de aprobación: {dmyTimeOf(r.decided_at)}
                        </Text>
                      ) : null}
                    </View>
                  )}

                  {/* Cuadro de Rechazo o Cancelación por el Solicitante */}
                  {r.status === 'rechazado' && (() => {
                    const infoCanc = extraerCancelacionCompra(r);
                    if (infoCanc.isCancelled) {
                      return (
                        <View
                          style={{
                            backgroundColor: scheme === 'dark' ? 'rgba(100,116,139,0.18)' : '#F8FAFC',
                            borderWidth: 1.5,
                            borderColor: scheme === 'dark' ? '#64748B' : '#CBD5E1',
                            padding: spacing.sm,
                            borderRadius: radius.md,
                            marginTop: 4,
                            gap: 3,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ fontSize: 15 }}>🚫</Text>
                            <Text style={{ color: scheme === 'dark' ? '#E2E8F0' : '#334155', fontWeight: '900', fontSize: 12 }}>
                              SOLICITUD CANCELADA POR EL SOLICITANTE
                            </Text>
                          </View>
                          <Text style={{ color: scheme === 'dark' ? '#CBD5E1' : '#475569', fontSize: 11.5, fontWeight: '700' }}>
                            Cancelada por: <Text style={{ fontWeight: '800' }}>{infoCanc.cancelledBy || r.decided_by_name || r.solicitante_nombre || 'Solicitante'}</Text>
                          </Text>
                          {infoCanc.cancelledAt || r.decided_at ? (
                            <Text style={{ color: scheme === 'dark' ? '#94A3B8' : '#64748B', fontSize: 11 }}>
                              📅 Fecha y hora: <Text style={{ fontWeight: '700' }}>{infoCanc.cancelledAt || (r.decided_at ? dmyTimeOf(r.decided_at) : '')}</Text>
                            </Text>
                          ) : null}
                          <View style={{ backgroundColor: colors.surface, padding: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginTop: 2 }}>
                            <Text style={{ color: colors.text, fontSize: 11.5 }}>
                              💬 Motivo: <Text style={{ fontWeight: '700' }}>{infoCanc.note || 'Cancelada voluntariamente por el solicitante'}</Text>
                            </Text>
                          </View>
                        </View>
                      );
                    }
                    return (
                      <View
                        style={{
                          backgroundColor: '#FEE2E2',
                          borderWidth: 1.5,
                          borderColor: '#F87171',
                          padding: spacing.sm,
                          borderRadius: radius.md,
                          marginTop: 4,
                          gap: 3,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 15 }}>❌</Text>
                          <Text style={{ color: '#991B1B', fontWeight: '900', fontSize: 12 }}>
                            SOLICITUD DE COMPRA RECHAZADA
                          </Text>
                        </View>
                        <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '700' }}>
                          Rechazado por: <Text style={{ color: '#991B1B', fontWeight: '800' }}>{r.decided_by_name || 'Compras / Gerencia'}</Text>
                        </Text>
                        {r.decided_at ? (
                          <Text style={{ color: '#7F1D1D', fontSize: 11.5 }}>
                            📅 Fecha y hora de rechazo: <Text style={{ fontWeight: '700' }}>{dmyTimeOf(r.decided_at)}</Text>
                          </Text>
                        ) : null}
                        <View style={{ backgroundColor: '#fff', padding: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.sm, marginTop: 2 }}>
                          <Text style={{ color: '#7F1D1D', fontSize: 11.5 }}>
                            💬 Motivo del rechazo: <Text style={{ fontWeight: '700' }}>{r.decision_note || 'Sin motivo especificado'}</Text>
                          </Text>
                        </View>
                      </View>
                    );
                  })()}

                  {/* Cuadro de Aclaratoria Técnica Pendiente */}
                  {r.status === 'aclaratoria_solicitada' && (
                    <View
                      style={{
                        backgroundColor: '#FFEDD5',
                        borderWidth: 1.5,
                        borderColor: '#FDBA74',
                        padding: spacing.sm,
                        borderRadius: radius.md,
                        marginTop: 4,
                        gap: 4,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 15 }}>⚠️</Text>
                        <Text style={{ color: '#9A3412', fontWeight: '800', fontSize: 12 }}>
                          ACLARATORIA TÉCNICA SOLICITADA POR COMPRAS
                        </Text>
                      </View>
                      <Text style={{ color: '#7C2D12', fontSize: 11.5, fontStyle: 'italic' }}>
                        "{r.aclaratoria_motivo}"
                      </Text>
                      <TouchableOpacity
                        onPress={() => abrirResponderAclaratoria(r)}
                        style={{
                          backgroundColor: '#EA580C',
                          paddingVertical: 7,
                          borderRadius: radius.sm,
                          alignItems: 'center',
                          marginTop: 2,
                        }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11.5 }}>
                          ✏️ Responder medidas y especificaciones
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {r.status === 'pendiente' && (
                    <View
                      style={{
                        backgroundColor: '#EFF6FF',
                        borderWidth: 1,
                        borderColor: '#BFDBFE',
                        padding: spacing.xs,
                        paddingHorizontal: spacing.sm,
                        borderRadius: radius.sm,
                        marginTop: 2,
                      }}
                    >
                      <Text style={{ color: '#1E40AF', fontSize: 11, fontWeight: '700' }}>
                        🛒 En revisión por el departamento de Compras y cotización con proveedores
                      </Text>
                    </View>
                  )}

                  {/* 🧾 Ficha Informativa: Factura Fiscal / Comercial */}
                  {fac && fac.numero ? (
                    <View
                      style={{
                        backgroundColor: fac.empresa?.toLowerCase().includes('golden') ? '#FEF3C7' : '#EEF2FF',
                        borderWidth: 1,
                        borderColor: fac.empresa?.toLowerCase().includes('golden') ? '#F59E0B' : '#818CF8',
                        borderRadius: radius.sm,
                        padding: spacing.xs,
                        paddingHorizontal: spacing.sm,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginTop: 2,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: fac.empresa?.toLowerCase().includes('golden') ? '#92400E' : '#3730A3', fontWeight: '800', fontSize: 11.5 }}>
                          🧾 Factura: N° {fac.numero} ({fac.empresa})
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          📅 Fecha: {fac.fecha || 'Sin fecha'}{fac.subidaPor ? ` · Subida por: ${fac.subidaPor}` : ''}
                        </Text>
                      </View>
                      {fac.url ? (
                        <TouchableOpacity
                          onPress={() => {
                            if (Platform.OS === 'web') {
                              window.open(fac.url!, '_blank');
                            } else {
                              Linking.openURL(fac.url!);
                            }
                          }}
                          style={{ backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
                        >
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>👁️ Ver Factura</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}

                  {/* 📦 Ficha Informativa: Control Físico en Almacén (Falta 3) */}
                  {r.status === 'recibido' && (
                    <View
                      style={{
                        backgroundColor: esRetirado ? '#F8FAFC' : '#F0FDF4',
                        borderWidth: 1,
                        borderColor: esRetirado ? '#93C5FD' : '#86EFAC',
                        borderRadius: radius.sm,
                        padding: spacing.xs,
                        paddingHorizontal: spacing.sm,
                        gap: 3,
                        marginTop: 2,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 13 }}>{esRetirado ? '📦' : '🟢'}</Text>
                        <Text style={{ color: esRetirado ? '#1E40AF' : '#15803D', fontWeight: '800', fontSize: 11.5 }}>
                          {esRetirado ? 'Retiro Físico de Almacén Registrado' : 'Repuesto Disponible en Galpón de Almacén'}
                        </Text>
                      </View>
                      {esRetirado ? (
                        <>
                          <Text style={{ color: colors.text, fontSize: 11 }}>
                            Retirado por: <Text style={{ fontWeight: '700' }}>{desp.retiradoPor}</Text>
                            {desp.retiradoCedula ? ` (CI: ${desp.retiradoCedula})` : ''}
                            {desp.fecha ? ` el ${dmyOf(desp.fecha)}` : ''}
                          </Text>
                          {desp.maquinariaCodigo || desp.maquinariaPlaca ? (
                            <Text style={{ color: '#1E3A5F', fontSize: 11, fontWeight: '700' }}>
                              🚜 Destino: {desp.maquinariaCodigo || ''} · Placa: {desp.maquinariaPlaca || 'Sin placa'}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={{ color: '#166534', fontSize: 11 }}>
                          Tu repuesto ya fue recibido por compras y está listo para ser retirado en galpón.
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Barra inferior: Expediente PDF + Botón Cancelar Solicitud (adaptable Teléfono y PC) */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    <TouchableOpacity
                      onPress={() => descargarExpediente(r)}
                      style={{
                        flex: 1,
                        minWidth: 200,
                        backgroundColor: '#1E3A5F',
                        paddingVertical: 9,
                        paddingHorizontal: 12,
                        borderRadius: radius.sm,
                        alignItems: 'center',
                        flexDirection: 'row',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <Text style={{ fontSize: 13 }}>📑</Text>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                        Expediente Completo de Compra (PDF)
                      </Text>
                    </TouchableOpacity>

                    {puedeCancelarSolicitudCompra(r, uid, fullName, esAdmin).ok && (
                      <TouchableOpacity
                        onPress={() =>
                          abrirModalCancelar({
                            tipo: 'compra',
                            ids: [r.id],
                            codigo: r.code || 'REQ',
                            titulo: r.title || 'Solicitud de Compra Técnica',
                            reqCompra: r,
                          })
                        }
                        activeOpacity={0.75}
                        style={{
                          flexGrow: Platform.OS === 'web' ? 0 : 1,
                          minWidth: 165,
                          backgroundColor: scheme === 'dark' ? 'rgba(239,68,68,0.16)' : '#FEF2F2',
                          borderWidth: 1.5,
                          borderColor: scheme === 'dark' ? '#F87171' : '#FCA5A5',
                          paddingVertical: 9,
                          paddingHorizontal: 14,
                          borderRadius: radius.sm,
                          alignItems: 'center',
                          flexDirection: 'row',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        <Text style={{ fontSize: 13 }}>🚫</Text>
                        <Text style={{ color: scheme === 'dark' ? '#FCA5A5' : '#DC2626', fontWeight: '800', fontSize: 12 }}>
                          Cancelar Solicitud
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Card>
              );
            })
          )}
        </View>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: FORMULARIO DE DESPACHO DE ALMACÉN                             */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={modalStockOpen} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center',
            padding: spacing.md,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: colors.border,
              maxHeight: '90%',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 17, fontWeight: '900', color: colors.text, marginBottom: 2 }}>
                📦 Solicitar Despacho de Almacén
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>
                Este repuesto tiene stock disponible. Se enviará la solicitud al almacenista para su entrega.
              </Text>

              {stockItem && (
                <View
                  style={{
                    backgroundColor: '#DCFCE7',
                    padding: spacing.sm,
                    borderRadius: radius.md,
                    marginBottom: spacing.md,
                  }}
                >
                  <Text style={{ color: '#166534', fontWeight: '800', fontSize: 14 }}>
                    {stockItem.name}
                  </Text>
                  <Text style={{ color: '#15803D', fontSize: 12, marginTop: 1 }}>
                    Stock disponible en almacén: {qtyFmt(stockItem.stock)} {stockItem.unit || 'UND'}
                  </Text>
                </View>
              )}

              {/* Cantidad */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Cantidad a retirar / solicitar:
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => {
                    const current = parseNum(stockQty);
                    setStockQty(String(Math.max(1, Math.round((current - 1) * 100) / 100)));
                  }}
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    width: 38,
                    height: 38,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>-</Text>
                </TouchableOpacity>

                <TextInput
                  value={stockQty}
                  onChangeText={(t) => setStockQty(onlyDecimal(t))}
                  keyboardType="numeric"
                  inputMode="decimal"
                  style={[inp, { flex: 1, fontWeight: '700', fontSize: 16, textAlign: 'center' }]}
                />

                <TouchableOpacity
                  onPress={() => {
                    const current = parseNum(stockQty);
                    setStockQty(String(Math.round((current + 1) * 100) / 100));
                  }}
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    width: 38,
                    height: 38,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>+</Text>
                </TouchableOpacity>

                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {stockItem?.unit || 'UND'}
                </Text>
              </View>

              {/* Urgencia */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Urgencia:</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.md }}>
                {(['normal', 'alta', 'urgente'] as StockRequestUrgency[]).map((u) => {
                  const cfg = URGENCIA_CONFIG[u];
                  const sel = stockUrgencia === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      onPress={() => setStockUrgencia(u)}
                      style={{
                        flex: 1,
                        paddingVertical: 7,
                        alignItems: 'center',
                        borderRadius: radius.md,
                        backgroundColor: sel ? cfg.color : colors.surfaceAlt,
                      }}
                    >
                      <Text style={{ color: sel ? '#fff' : colors.text, fontWeight: '700', fontSize: 11.5 }}>
                        {cfg.icon} {cfg.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Motivo */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Motivo / Falla / Trabajo a realizar (opcional):
              </Text>
              <TextInput
                value={stockMotivo}
                onChangeText={setStockMotivo}
                placeholder="Ej: Cambio de aceite preventivo, manguera rota en campo…"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={3}
                style={[inp, { height: 75, textAlignVertical: 'top', marginBottom: spacing.md }]}
              />

              {/* Botones */}
              <View style={{ gap: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => {
                    if (!stockItem) return;
                    const qty = Math.max(1, parseNum(stockQty));
                    agregarItemAlCarrito({
                      tipo: 'stock',
                      itemId: stockItem.id,
                      name: stockItem.name,
                      sku: stockItem.sku,
                      unit: stockItem.unit || 'UND',
                      qty,
                      stockDisponible: stockItem.stock || 0,
                      urgency: stockUrgencia,
                      reason: stockMotivo.trim() || undefined,
                    });
                    setModalStockOpen(false);
                  }}
                  style={{
                    backgroundColor: colors.brand,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 6,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>➕</Text>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 14 }}>
                    Agregar a la Solicitud
                  </Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={() => setModalStockOpen(false)}
                    disabled={stockBusy}
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
                    onPress={enviarSolicitudStock}
                    disabled={stockBusy}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: radius.md,
                      backgroundColor: '#059669',
                      alignItems: 'center',
                      opacity: stockBusy ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                      {stockBusy ? 'Enviando…' : '🚀 Enviar solo este'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: FORMULARIO DE COMPRA TÉCNICA (CON MEDIDAS OBLIGATORIAS)      */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={modalCompraOpen} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center',
            padding: spacing.md,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: colors.border,
              maxHeight: '92%',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 17, fontWeight: '900', color: colors.text, marginBottom: 2 }}>
                🛒 Solicitud Técnica de Compra
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>
                Para repuestos sin stock o piezas nuevas. Se envía directamente al departamento de Compras.
              </Text>

              {/* Nombre de la pieza */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Nombre del Repuesto o Pieza: *
              </Text>
              <TextInput
                value={compraItemName}
                onChangeText={setCompraItemName}
                placeholder="Ej: Rolinera de masa, Correa de alternador, Filtro hidráulico…"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.sm, fontWeight: '700' }]}
              />

              {/* Medidas y especificaciones obligatorias */}
              <View
                style={{
                  // 🌙 En modo oscuro el azul claro fijo dejaba el texto (blanco) sin contraste.
                  backgroundColor: scheme === 'dark' ? 'rgba(59,130,246,0.14)' : '#EFF6FF',
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: '#93C5FD',
                  marginBottom: spacing.sm,
                }}
              >
                <Text style={{ color: scheme === 'dark' ? '#93C5FD' : '#1E40AF', fontWeight: '800', fontSize: 12 }}>
                  📐 Medidas y Especificaciones Técnicas (OBLIGATORIO): *
                </Text>
                <Text style={{ color: scheme === 'dark' ? '#BFDBFE' : '#1E3A8A', fontSize: 11, marginVertical: 2 }}>
                  Indica diámetro, rosca, paso, código de parte, marca y modelo de la máquina. Esto evita
                  que el proveedor detenga la cotización por falta de datos.
                </Text>
                <TextInput
                  value={compraMedidas}
                  onChangeText={setCompraMedidas}
                  placeholder="Ej: Diámetro exterior 52mm, interior 25mm, rosca métrica 1.5, marca CAT 320D, código de pieza 1R-0716…"
                  placeholderTextColor="#64748B"
                  multiline
                  numberOfLines={3}
                  style={[
                    inp,
                    {
                      backgroundColor: colors.surface,
                      height: 75,
                      textAlignVertical: 'top',
                      borderColor: '#93C5FD',
                      marginTop: 4,
                    },
                  ]}
                />
              </View>

              {/* Foto de la muestra vieja o placa */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Foto de la muestra vieja o placa del equipo:
              </Text>
              {compraFoto ? (
                <View style={{ marginBottom: spacing.sm, alignItems: 'center' }}>
                  <Image
                    source={{ uri: compraFoto }}
                    style={{ width: '100%', height: 160, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
                  />
                  <TouchableOpacity
                    onPress={() => setCompraFoto(null)}
                    style={{ marginTop: 4, paddingVertical: 4 }}
                  >
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>
                      🗑 Quitar foto
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <TouchableOpacity
                    onPress={() => tomarFotoCompra('camara')}
                    disabled={compraSubiendoFoto}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingVertical: 10,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>📷</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                      {compraSubiendoFoto ? 'Cargando…' : 'Tomar Foto'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => tomarFotoCompra('galeria')}
                    disabled={compraSubiendoFoto}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingVertical: 10,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>🖼️</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                      {compraSubiendoFoto ? 'Cargando…' : 'Subir Imagen'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Cantidad y Unidad */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                <View style={{ flex: 1.4 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Cantidad:</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const current = parseNum(compraQty);
                        setCompraQty(String(Math.max(1, Math.round((current - 1) * 100) / 100)));
                      }}
                      style={{
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        width: 36,
                        height: 38,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>-</Text>
                    </TouchableOpacity>

                    <TextInput
                      value={compraQty}
                      onChangeText={(t) => setCompraQty(onlyDecimal(t))}
                      keyboardType="numeric"
                      inputMode="decimal"
                      style={[inp, { flex: 1, textAlign: 'center', fontWeight: '700', height: 38 }]}
                    />

                    <TouchableOpacity
                      onPress={() => {
                        const current = parseNum(compraQty);
                        setCompraQty(String(Math.round((current + 1) * 100) / 100));
                      }}
                      style={{
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        width: 36,
                        height: 38,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Unidad:</Text>
                  <TextInput
                    value={compraUnit}
                    onChangeText={(t) => setCompraUnit(t.toUpperCase())}
                    placeholder="UND"
                    placeholderTextColor={colors.muted}
                    style={[inp, { textAlign: 'center', fontWeight: '700', height: 38 }]}
                  />
                </View>
              </View>

              {/* Motivo */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>
                Motivo / Justificación de la compra (opcional):
              </Text>
              <TextInput
                value={compraMotivo}
                onChangeText={setCompraMotivo}
                placeholder="Ej: Desgaste severo en faena, pieza fracturada…"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.md }]}
              />

              {/* 🏬 Proveedor Sugerido (Opcional - Audio Jefes de Dpto) */}
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1.5,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  padding: spacing.sm,
                  marginBottom: spacing.md,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Text style={{ fontSize: 16 }}>🏬</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                    ¿Tienes un Proveedor Sugerido? (Opcional)
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: 8 }}>
                  Si ya conoces un proveedor o tienda donde conseguir este repuesto, anota sus datos para que Compras lo gestione más rápido.
                </Text>

                <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '700', marginBottom: 2 }}>
                  Nombre del Proveedor / Tienda:
                </Text>
                <TextInput
                  value={compraProvNombre}
                  onChangeText={setCompraProvNombre}
                  placeholder="Ej: Repuestos El Tren, Tornillos y Tuercas C.A.…"
                  placeholderTextColor={colors.muted}
                  style={[inp, { marginBottom: 6, fontSize: 12.5 }]}
                />

                <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '700', marginBottom: 2 }}>
                  Teléfono de Contacto:
                </Text>
                <TextInput
                  value={compraProvTelefono}
                  onChangeText={setCompraProvTelefono}
                  keyboardType="phone-pad"
                  placeholder="Ej: 0414-1234567 / 0286-9234567"
                  placeholderTextColor={colors.muted}
                  style={[inp, { marginBottom: 6, fontSize: 12.5 }]}
                />

                <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '700', marginBottom: 2 }}>
                  Dirección o Ubicación física:
                </Text>
                <TextInput
                  value={compraProvDireccion}
                  onChangeText={setCompraProvDireccion}
                  placeholder="Ej: Calle 4 con Av. 5, diagonal a la bomba…"
                  placeholderTextColor={colors.muted}
                  style={[inp, { fontSize: 12.5 }]}
                />
              </View>

              {/* Botones */}
              <View style={{ gap: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => {
                    if (!compraItemName.trim()) {
                      return toast.error('Indica el nombre del repuesto o pieza a comprar.');
                    }
                    if (!compraMedidas.trim()) {
                      return toast.error(
                        'Las medidas y especificaciones técnicas son OBLIGATORIAS (diámetro, rosca, paso, N° de parte, etc.).'
                      );
                    }
                    const qty = Math.max(1, parseNum(compraQty));
                    agregarItemAlCarrito({
                      tipo: 'compra',
                      itemId: compraProductId,
                      name: compraItemName.trim(),
                      unit: compraUnit.trim().toUpperCase() || 'UND',
                      qty,
                      medidas: compraMedidas.trim(),
                      reason: compraMotivo.trim() || undefined,
                      fotoUrl: compraFoto || null,
                      proveedorSugerido: (compraProvNombre.trim() || compraProvTelefono.trim() || compraProvDireccion.trim()) ? {
                        nombre: compraProvNombre.trim(),
                        telefono: compraProvTelefono.trim(),
                        direccion: compraProvDireccion.trim(),
                      } : null,
                    });
                    setModalCompraOpen(false);
                  }}
                  style={{
                    backgroundColor: colors.brand,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 6,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>➕</Text>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 14 }}>
                    Agregar a la Solicitud
                  </Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={() => setModalCompraOpen(false)}
                    disabled={compraBusy}
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
                    onPress={enviarSolicitudCompra}
                    disabled={compraBusy}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: radius.md,
                      backgroundColor: '#2563EB',
                      alignItems: 'center',
                      opacity: compraBusy ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                      {compraBusy ? 'Enviando…' : '🛒 Enviar solo este'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: RESPONDER ACLARATORIA TÉCNICA DE COMPRAS                      */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={modalAclaratoriaOpen} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center',
            padding: spacing.md,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: '#EA580C',
              maxHeight: '90%',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 17, fontWeight: '900', color: colors.text, marginBottom: 2 }}>
                ⚠️ Responder Aclaratoria Técnica
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>
                Compras y el proveedor necesitan estos datos para poder concretar la compra.
              </Text>

              {aclaratoriaTarget && (
                <View
                  style={{
                    backgroundColor: '#FFEDD5',
                    padding: spacing.md,
                    borderRadius: radius.md,
                    marginBottom: spacing.md,
                    borderWidth: 1,
                    borderColor: '#FDBA74',
                  }}
                >
                  <Text style={{ color: '#9A3412', fontWeight: '800', fontSize: 12 }}>
                    Requerimiento: {aclaratoriaTarget.code}
                  </Text>
                  <Text style={{ color: '#7C2D12', fontSize: 13, marginTop: 4, fontWeight: '700' }}>
                    Pregunta de {aclaratoriaTarget.aclaratoria_solicitada_por || 'Compras'}:
                  </Text>
                  <Text style={{ color: '#7C2D12', fontSize: 13, marginTop: 2, fontStyle: 'italic' }}>
                    "{aclaratoriaTarget.aclaratoria_motivo}"
                  </Text>
                </View>
              )}

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Tu respuesta técnica (medidas exactas, modelo o aclaratoria): *
              </Text>
              <TextInput
                value={aclaratoriaRespuesta}
                onChangeText={setAclaratoriaRespuesta}
                placeholder="Escribe la respuesta técnica solicitada…"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={4}
                style={[inp, { height: 100, textAlignVertical: 'top', marginBottom: spacing.lg }]}
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => setModalAclaratoriaOpen(false)}
                  disabled={aclaratoriaBusy}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceAlt,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={enviarRespuestaAclaratoria}
                  disabled={aclaratoriaBusy}
                  style={{
                    flex: 2,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    backgroundColor: '#EA580C',
                    alignItems: 'center',
                    opacity: aclaratoriaBusy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>
                    {aclaratoriaBusy ? 'Enviando…' : '✓ Enviar Respuesta'}
                  </Text>
                </TouchableOpacity>
              </View>

              {aclaratoriaTarget && puedeCancelarSolicitudCompra(aclaratoriaTarget, uid, fullName, esAdmin).ok && (
                <TouchableOpacity
                  onPress={() => {
                    const target = aclaratoriaTarget;
                    setModalAclaratoriaOpen(false);
                    abrirModalCancelar({
                      tipo: 'compra',
                      ids: [target.id],
                      codigo: target.code || 'REQ',
                      titulo: target.title || 'Solicitud de Compra Técnica',
                      reqCompra: target,
                    });
                  }}
                  style={{
                    marginTop: spacing.md,
                    paddingVertical: 10,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: scheme === 'dark' ? '#F87171' : '#FCA5A5',
                    backgroundColor: scheme === 'dark' ? 'rgba(239,68,68,0.14)' : '#FEF2F2',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: scheme === 'dark' ? '#FCA5A5' : '#DC2626', fontWeight: '800', fontSize: 12 }}>
                    🚫 Ya no necesito este repuesto · Cancelar solicitud
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: CONFIRMAR CANCELACIÓN DE SOLICITUD (TELÉFONO Y PC)            */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={modalCancelarOpen} transparent animationType="fade" onRequestClose={() => setModalCancelarOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.65)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.md,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 480,
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1.5,
              borderColor: scheme === 'dark' ? '#7F1D1D' : '#FCA5A5',
              maxHeight: '90%',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 20 }}>🚫</Text>
                <Text style={{ fontSize: 17, fontWeight: '900', color: colors.text, flex: 1 }}>
                  Cancelar Solicitud
                </Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                Esta acción retirará la solicitud de la cola de{' '}
                {cancelTarget?.tipo === 'compra' || cancelTarget?.tipo === 'compra_renglon' ? 'Compras' : 'Almacén'} y dejará constancia en el historial.
              </Text>

              {cancelTarget && (
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderLeftWidth: 4,
                    borderLeftColor: '#DC2626',
                    borderRadius: radius.md,
                    padding: spacing.sm,
                    marginBottom: spacing.md,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                    {cancelTarget.codigo}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    {cancelTarget.titulo}
                  </Text>
                </View>
              )}

              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5, marginBottom: 6 }}>
                Selecciona el motivo de cancelación (1 toque): *
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
                {MOTIVOS_CANCELACION_RAPIDOS.map((m) => {
                  const active = cancelMotivoChip === m.label;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => setCancelMotivoChip(m.label)}
                      activeOpacity={0.75}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: radius.md,
                        backgroundColor: active
                          ? (scheme === 'dark' ? 'rgba(220,38,38,0.28)' : '#FEE2E2')
                          : colors.surfaceAlt,
                        borderWidth: 1.5,
                        borderColor: active ? '#DC2626' : colors.border,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Text style={{ fontSize: 13 }}>{active ? '✓' : m.icon}</Text>
                      <Text
                        style={{
                          color: active
                            ? (scheme === 'dark' ? '#FCA5A5' : '#991B1B')
                            : colors.text,
                          fontWeight: active ? '800' : '600',
                          fontSize: 12,
                        }}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Nota o explicación adicional (opcional):
              </Text>
              <TextInput
                value={cancelNotaLibre}
                onChangeText={setCancelNotaLibre}
                placeholder="Ej: Se reparó en taller o se usó otra pieza disponible…"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={2}
                style={[inp, { height: 64, textAlignVertical: 'top', marginBottom: spacing.md }]}
              />

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => setModalCancelarOpen(false)}
                  disabled={cancelBusy}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    paddingVertical: 11,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                    Volver
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={confirmarCancelacion}
                  disabled={cancelBusy}
                  style={{
                    flex: 1.6,
                    minWidth: 175,
                    paddingVertical: 11,
                    borderRadius: radius.md,
                    backgroundColor: '#DC2626',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 6,
                    opacity: cancelBusy ? 0.6 : 1,
                  }}
                >
                  {cancelBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ fontSize: 13 }}>🚫</Text>
                  )}
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>
                    {cancelBusy ? 'Cancelando…' : 'Confirmar Cancelación'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
