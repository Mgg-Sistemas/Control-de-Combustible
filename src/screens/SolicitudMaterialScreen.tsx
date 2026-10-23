// ── Solicitud de Material / Repuestos (Existencia vs Compra Técnica) ───────
// Permite que mecánicos (ej. Osma), encargados de taller, supervisores o
// cualquier personal externo a Compras consulte existencias y solicite repuestos.
// 1) Si hay stock en Almacén: genera Solicitud de Despacho (inventory_stock_requests).
// 2) Si NO hay stock o es pieza nueva: genera Solicitud de Compra Técnica (inventory_requirements)
//    con medidas técnicas OBLIGATORIAS, foto y ciclo de aclaratorias.
import React, { useMemo, useState } from 'react';
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
} from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Badge, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
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
} from '../lib/solicitudMaterial';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const parseNum = leerNumero;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
const nowISO = () => new Date().toISOString();
const dmyOf = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export default function SolicitudMaterialScreen() {
  const { colors } = useTheme();
  const { session, fullName } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const uid = session?.user?.id ?? null;

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

  // ── PASO 1: Destino y Solicitante ──────────────────────────────────────────
  const [destinoTipo, setDestinoTipo] = useState<'maquinaria' | 'vehiculo' | 'area'>('maquinaria');
  const [machineryId, setMachineryId] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string>('');
  const [areaTexto, setAreaTexto] = useState<string>('');
  const [solicitante, setSolicitante] = useState<PersonaElegida>(() => {
    return fullName ? { nombre: fullName.toUpperCase(), employeeId: null } : SIN_PERSONA;
  });

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
        // Si la tabla no está creada en la base aún, alertar con instrucciones
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
            ? `Maquinaria ${targetMach.code} · ${targetMach.serial || ''} (${targetMach.marca || ''} ${targetMach.modelo || ''})`
            : 'Maquinaria'
          : destinoTipo === 'vehiculo'
          ? targetVeh
            ? `Vehículo ${targetVeh.plate} (${targetVeh.brand || ''} ${targetVeh.model || ''})`
            : 'Vehículo'
          : areaTexto.trim() || 'Taller General';

      const items = [
        {
          product_id: compraProductId,
          name: compraItemName.trim(),
          unit: compraUnit.trim().toUpperCase() || 'UND',
          qty,
          est_price: 0,
          currency: 'USD' as const,
          note: compraMedidas.trim(),
          image_url: compraFoto || null,
        },
      ];

      const solicitanteNombre =
        solicitante.nombre || fullName || session?.user?.email || 'Taller';

      const payload = {
        code,
        title: `Pedido técnico: ${compraItemName.trim()} para ${targetLabel}`,
        note: compraMotivo.trim()
          ? `MOTIVO: ${compraMotivo.trim()} · ESPECIFICACIONES: ${compraMedidas.trim()}`
          : `ESPECIFICACIONES: ${compraMedidas.trim()}`,
        status: 'pendiente',
        items,
        requested_by: uid,
        requested_by_name: fullName || session?.user?.email || 'Taller',
        solicitante_nombre: solicitanteNombre,
        solicitante_employee_id: solicitante.employeeId || null,
        destino_tipo: destinoTipo === 'maquinaria' || destinoTipo === 'vehiculo' ? destinoTipo : null,
        area: destinoTipo === 'area' ? areaTexto.trim() || null : 'TALLER / MANTENIMIENTO',
        observaciones: `Solicitud creada desde el portal técnico de taller para ${targetLabel}.`,
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
      toast.error(e?.message ?? 'No se pudo crear la solicitud de compra.');
    } finally {
      setCompraBusy(false);
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
      toast.error(e?.message ?? 'No se pudo enviar la respuesta.');
    } finally {
      setAclaratoriaBusy(false);
    }
  };

  // Cantidad de aclaratorias pendientes por responder
  const totalAclaratorias = useMemo(() => {
    return (requirements || []).filter((r) => r.status === 'aclaratoria_solicitada').length;
  }, [requirements]);

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
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 3 }}>
                  Selecciona la Máquina:
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                  {machines.map((m) => {
                    const sel = machineryId === m.id;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => setMachineryId(m.id)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: radius.pill,
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
                          🚜 {m.code}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {destinoTipo === 'vehiculo' && (
              <View style={{ marginBottom: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 3 }}>
                  Selecciona el Vehículo / Camioneta:
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                  {vehicles.map((v) => {
                    const sel = vehicleId === v.id;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        onPress={() => setVehicleId(v.id)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: radius.pill,
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
                          🚗 {v.plate} ({v.model || v.brand || 'Vehículo'})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
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
                        </View>

                        {/* Botón según disponibilidad */}
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                          {tieneStock ? (
                            <TouchableOpacity
                              onPress={() => abrirPedirStock(item)}
                              style={{
                                flex: 1,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                backgroundColor: '#059669',
                                paddingVertical: 9,
                                borderRadius: radius.md,
                              }}
                            >
                              <Text style={{ fontSize: 15 }}>📦</Text>
                              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                                Solicitar de Almacén (Existencia)
                              </Text>
                            </TouchableOpacity>
                          ) : (
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
        </View>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* VISTA 2: MIS SOLICITUDES (SEGUIMIENTO Y ACLARATORIAS)                  */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'mis_solicitudes' && (
        <View style={{ gap: spacing.md }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Consulta el estado de tus solicitudes de existencia al almacén y solicitudes de compra.
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

              {requirements
                .filter((r) => r.status === 'aclaratoria_solicitada')
                .map((r) => {
                  return (
                    <View
                      key={r.id}
                      style={{
                        backgroundColor: '#fff',
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

                      <TouchableOpacity
                        onPress={() => abrirResponderAclaratoria(r)}
                        style={{
                          backgroundColor: '#EA580C',
                          paddingVertical: 9,
                          borderRadius: radius.md,
                          alignItems: 'center',
                          marginTop: 4,
                        }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                          ✏️ Responder medidas y especificaciones
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
            </Card>
          )}

          {/* 2) Solicitudes de Despacho de Almacén (Existencias) */}
          <SectionTitle>📦 Pedidos de Despacho al Almacén ({stockRequests?.length || 0})</SectionTitle>
          {stockRequests?.length === 0 ? (
            <EmptyState
              title="Sin pedidos de almacén"
              subtitle="No has solicitado materiales del stock de almacén todavía."
            />
          ) : (
            stockRequests.map((s) => {
              const est = ESTADO_EXISTENCIA_CONFIG[s.status] || ESTADO_EXISTENCIA_CONFIG.pendiente;
              const urg = URGENCIA_CONFIG[s.urgency] || URGENCIA_CONFIG.normal;
              return (
                <Card key={s.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }}>
                      {s.code} · {s.item_name}
                    </Text>
                    <View
                      style={{
                        backgroundColor: est.bg,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: radius.pill,
                      }}
                    >
                      <Text style={{ color: est.color, fontWeight: '800', fontSize: 11 }}>
                        {est.icon} {est.label}
                      </Text>
                    </View>
                  </View>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Cantidad: <Text style={{ color: colors.text, fontWeight: '700' }}>{qtyFmt(s.qty)} {s.unit || 'UND'}</Text>
                    {s.solicitante_nombre ? ` · Solicita: ${s.solicitante_nombre}` : ''}
                  </Text>

                  {s.reason ? (
                    <Text style={{ color: colors.brandText, fontSize: 11, fontStyle: 'italic' }}>
                      Motivo: {s.reason}
                    </Text>
                  ) : null}

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      Fecha: {dmyOf(s.created_at)}
                    </Text>
                    <View style={{ backgroundColor: urg.bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm }}>
                      <Text style={{ color: urg.color, fontSize: 10.5, fontWeight: '700' }}>
                        Urgencia {urg.label}
                      </Text>
                    </View>
                  </View>

                  {s.status === 'despachado' && s.dispatched_at ? (
                    <Text style={{ color: '#16A34A', fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                      ✓ Despachado por {s.dispatched_by_name || 'Almacenista'} el {dmyOf(s.dispatched_at)}
                    </Text>
                  ) : null}
                  {s.status === 'rechazado' && s.rejection_note ? (
                    <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                      ✕ Motivo de rechazo: {s.rejection_note}
                    </Text>
                  ) : null}
                </Card>
              );
            })
          )}

          {/* 3) Requerimientos de Compra (Técnicos) */}
          <SectionTitle>🛒 Requerimientos de Compra ({requirements?.length || 0})</SectionTitle>
          {requirements?.length === 0 ? (
            <EmptyState
              title="Sin requerimientos de compra"
              subtitle="No hay solicitudes de compra registradas."
            />
          ) : (
            requirements.slice(0, 30).map((r) => {
              const est = ESTADO_COMPRA_CONFIG[r.status] || ESTADO_COMPRA_CONFIG.pendiente;
              return (
                <Card key={r.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }}>
                      {r.code} · {r.title || 'Requerimiento de compra'}
                    </Text>
                    <View
                      style={{
                        backgroundColor: est.bg,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: radius.pill,
                      }}
                    >
                      <Text style={{ color: est.color, fontWeight: '800', fontSize: 11 }}>
                        {est.icon} {est.label}
                      </Text>
                    </View>
                  </View>

                  {r.solicitante_nombre ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      Solicitante: <Text style={{ color: colors.text, fontWeight: '700' }}>{r.solicitante_nombre}</Text>
                      {r.area ? ` · Área: ${r.area}` : ''}
                    </Text>
                  ) : null}

                  {/* Renglones */}
                  <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.sm, borderRadius: radius.sm, gap: 4 }}>
                    {(r.items || []).map((it, idx) => (
                      <View key={idx}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                          • {it.name} ({qtyFmt(it.qty)} {it.unit || 'UND'})
                        </Text>
                        {it.note ? (
                          <Text style={{ color: colors.brandText, fontSize: 11, fontStyle: 'italic', marginLeft: 8 }}>
                            📐 Medidas/Specs: {it.note}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      Fecha: {dmyOf(r.created_at)}
                    </Text>
                    {r.attachment_url ? (
                      <Text style={{ color: colors.brand, fontSize: 11, fontWeight: '700' }}>
                        📷 Con foto adjunta
                      </Text>
                    ) : null}
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
                <TextInput
                  value={stockQty}
                  onChangeText={(t) => setStockQty(onlyDecimal(t))}
                  keyboardType="numeric"
                  inputMode="decimal"
                  style={[inp, { flex: 1, fontWeight: '700', fontSize: 16 }]}
                />
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
                style={[inp, { height: 75, textAlignVertical: 'top', marginBottom: spacing.lg }]}
              />

              {/* Botones */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => setModalStockOpen(false)}
                  disabled={stockBusy}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
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
                    flex: 2,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    backgroundColor: '#059669',
                    alignItems: 'center',
                    opacity: stockBusy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>
                    {stockBusy ? 'Enviando…' : '🚀 Enviar Pedido a Almacén'}
                  </Text>
                </TouchableOpacity>
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
                  backgroundColor: '#EFF6FF',
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: '#93C5FD',
                  marginBottom: spacing.sm,
                }}
              >
                <Text style={{ color: '#1E40AF', fontWeight: '800', fontSize: 12 }}>
                  📐 Medidas y Especificaciones Técnicas (OBLIGATORIO): *
                </Text>
                <Text style={{ color: '#1E3A8A', fontSize: 11, marginVertical: 2 }}>
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
                      backgroundColor: '#fff',
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
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Cantidad:</Text>
                  <TextInput
                    value={compraQty}
                    onChangeText={(t) => setCompraQty(onlyDecimal(t))}
                    keyboardType="numeric"
                    inputMode="decimal"
                    style={[inp, { textAlign: 'center', fontWeight: '700' }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Unidad:</Text>
                  <TextInput
                    value={compraUnit}
                    onChangeText={(t) => setCompraUnit(t.toUpperCase())}
                    placeholder="UND"
                    placeholderTextColor={colors.muted}
                    style={[inp, { textAlign: 'center', fontWeight: '700' }]}
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
                style={[inp, { marginBottom: spacing.lg }]}
              />

              {/* Botones */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => setModalCompraOpen(false)}
                  disabled={compraBusy}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
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
                    flex: 2,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    backgroundColor: colors.brand,
                    alignItems: 'center',
                    opacity: compraBusy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>
                    {compraBusy ? 'Enviando…' : '🛒 Enviar a Compras'}
                  </Text>
                </TouchableOpacity>
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
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
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
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
