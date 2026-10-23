import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { norm, onlyDecimal } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { InventoryRequirement, RequirementLine, Company, Supplier, Machinery, Vehicle } from '../types/database';
import { useBcvRate, bsFromUsd, usdFromBs, fmtBs } from '../lib/bcv';
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

const ESTADOS_SOLICITUD: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pendiente: { label: 'Pendiente de Cotización', color: '#D97706', bg: '#FEF3C7', icon: '⏳' },
  aclaratoria_solicitada: { label: 'En Aclaratoria Técnica', color: '#EA580C', bg: '#FFEDD5', icon: '⚠️' },
  aprobado: { label: 'Convertido / Aprobado', color: '#16A34A', bg: '#DCFCE7', icon: '✅' },
  rechazado: { label: 'Rechazado', color: '#DC2626', bg: '#FEE2E2', icon: '❌' },
  recibido: { label: 'Recibido en Almacén', color: '#2563EB', bg: '#DBEAFE', icon: '📦' },
};

export function SolicitudesCompraTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
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

  // Buscador y filtros
  const [query, setQuery] = useState('');
  const [filterEstado, setFilterEstado] = useState<'todos' | 'pendiente' | 'aclaratoria' | 'convertido' | 'rechazado'>('todos');

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

  // Filtrado de solicitudes de compra (todas las que vienen del taller/solicitudes o pendientes)
  const solicitudes = useMemo(() => {
    return (allReqs || []).filter((r) => {
      // Coincide con solicitudes técnicas o las creadas desde el portal de pedidos
      const isTecnico =
        Boolean(r.solicitante_nombre) ||
        (r.title && r.title.toLowerCase().includes('pedido técnico')) ||
        (r.observaciones && r.observaciones.toLowerCase().includes('portal técnico')) ||
        r.items.some((it) => Boolean(it.note && it.note.trim()));

      if (!isTecnico) return false;

      // Filtro de estado
      if (filterEstado === 'pendiente' && r.status !== 'pendiente') return false;
      if (filterEstado === 'aclaratoria' && r.status !== 'aclaratoria_solicitada') return false;
      if (filterEstado === 'convertido' && r.status !== 'aprobado' && r.status !== 'recibido') return false;
      if (filterEstado === 'rechazado' && r.status !== 'rechazado') return false;

      // Buscador
      if (query.trim()) {
        const q = norm(query);
        const matchCode = r.code && norm(r.code).includes(q);
        const matchTitle = r.title && norm(r.title).includes(q);
        const matchSolicitante = r.solicitante_nombre && norm(r.solicitante_nombre).includes(q);
        const matchArea = r.area && norm(r.area).includes(q);
        const matchItems = r.items.some(
          (it) => norm(it.name).includes(q) || (it.note && norm(it.note).includes(q))
        );
        return matchCode || matchTitle || matchSolicitante || matchArea || matchItems;
      }

      return true;
    });
  }, [allReqs, filterEstado, query]);

  // Contadores para chips
  const countPendientes = useMemo(
    () => (allReqs || []).filter((r) => r.status === 'pendiente').length,
    [allReqs]
  );
  const countAclaratorias = useMemo(
    () => (allReqs || []).filter((r) => r.status === 'aclaratoria_solicitada').length,
    [allReqs]
  );

  // Abrir Modal de Conversión a Requerimiento
  const abrirConvertir = (r: InventoryRequirement) => {
    setConvertTarget(r);
    setConvertSupplierId(r.supplier_id || null);
    setConvertCompanyId(r.company_id || null);
    setConvertEmpresaPagadoraId(r.empresa_pagadora_id || null);
    const primerItem = r.items[0];
    setConvertPrice(primerItem && Number(primerItem.est_price) > 0 ? String(primerItem.est_price) : '');
    setConvertCurrency((primerItem?.currency as 'USD' | 'VES') || 'USD');
    setConvertNote(r.note || '');
  };

  const ejecutarConversion = async () => {
    if (!convertTarget) return;
    setConvertBusy(true);

    try {
      const priceNum = parseNum(convertPrice);
      const updatedItems = convertTarget.items.map((it) => ({
        ...it,
        est_price: priceNum > 0 ? priceNum : it.est_price || 0,
        currency: convertCurrency,
      }));

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
          { key: 'todos', label: `Todos (${solicitudes.length})` },
          { key: 'pendiente', label: `⏳ Pendientes (${countPendientes})` },
          { key: 'aclaratoria', label: `⚠️ En Aclaratoria (${countAclaratorias})` },
          { key: 'convertido', label: '✅ Convertidos a Requerimiento' },
          { key: 'rechazado', label: '❌ Rechazados' },
        ].map((f) => {
          const sel = filterEstado === f.key;
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
          const est = ESTADOS_SOLICITUD[r.status] || ESTADOS_SOLICITUD.pendiente;
          const primerItem = r.items[0];
          const tieneFoto = r.attachment_url || primerItem?.image_url;

          return (
            <Card key={r.id} style={{ gap: 8, marginBottom: spacing.xs }}>
              {/* Encabezado: Código y Estado */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text style={{ fontWeight: '900', fontSize: 15, color: colors.text }}>
                    {r.code} · {primerItem ? primerItem.name : r.title || 'Solicitud de Compra'}
                  </Text>
                  {r.title && r.title !== primerItem?.name ? (
                    <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 1 }}>{r.title}</Text>
                  ) : null}
                </View>

                <View style={{ backgroundColor: est.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill }}>
                  <Text style={{ color: est.color, fontWeight: '800', fontSize: 11 }}>
                    {est.icon} {est.label}
                  </Text>
                </View>
              </View>

              {/* Fila destacada de Metadatos Obligatorios (Quién, Fecha/Hora, Destino) */}
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
              </View>

              {/* Renglones y Especificaciones Técnicas Obligatorias */}
              <View style={{ gap: 6 }}>
                {r.items.map((it, idx) => (
                  <View
                    key={idx}
                    style={{
                      borderWidth: 1,
                      borderColor: '#93C5FD',
                      backgroundColor: '#EFF6FF',
                      padding: spacing.sm,
                      borderRadius: radius.sm,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                        {idx + 1}. {it.name}
                      </Text>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                        Cant: {qtyFmt(it.qty)} {it.unit || 'UND'}
                      </Text>
                    </View>

                    {/* Especificaciones / Medidas técnicas del taller */}
                    {it.note ? (
                      <View style={{ marginTop: 2, backgroundColor: '#fff', padding: 6, borderRadius: 4, borderWidth: 1, borderColor: '#BFDBFE' }}>
                        <Text style={{ color: '#1E40AF', fontSize: 11.5, fontWeight: '700' }}>
                          📐 Especificaciones y Medidas Técnicas:
                        </Text>
                        <Text style={{ color: '#1E3A8A', fontSize: 12, marginTop: 1 }}>{it.note}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>

              {/* Foto adjunta de la pieza */}
              {tieneFoto ? (
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

              {/* Botones de Acción para el comprador / Admin */}
              {canWrite && (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4, flexWrap: 'wrap' }}>
                  {/* Botón 1: Convertir en Requerimiento Oficial */}
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

                  {/* Botón 2: Pedir Aclaratoria Técnica al solicitante */}
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

                  {/* Botón 3: Rechazar si no procede */}
                  {r.status !== 'rechazado' && (
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
              )}
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

              {/* Proveedor cotizado */}
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>
                Proveedor Sugerido / Cotizado:
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: spacing.sm, paddingVertical: 2 }}>
                <TouchableOpacity
                  onPress={() => setConvertSupplierId(null)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    backgroundColor: !convertSupplierId ? colors.brand : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: !convertSupplierId ? colors.brand : colors.border,
                  }}
                >
                  <Text style={{ color: !convertSupplierId ? colors.brandContrast : colors.text, fontSize: 11, fontWeight: '700' }}>
                    Por cotizar
                  </Text>
                </TouchableOpacity>
                {suppliers.map((s) => {
                  const sel = convertSupplierId === s.id;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => setConvertSupplierId(s.id)}
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
                        🏭 {s.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

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
    </Screen>
  );
}
