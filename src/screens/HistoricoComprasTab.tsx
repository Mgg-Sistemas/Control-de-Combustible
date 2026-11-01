import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, SkeletonList } from '../components/ui';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useTable } from '../hooks/useTable';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm, matchNorm } from '../lib/text';
import type {
  InventoryRequirement,
  Cuenta,
  CuentaAbono,
  PurchaseOrder,
  Company,
  Supplier,
  Machinery,
  Vehicle,
  AuditLog,
} from '../types/database';
import {
  construirTimelineExpediente,
  resolverRequerimientoVinculadoACuenta,
  fmtFechaHora,
  fmtFechaCorta,
  fmtSoloHora,
  toLocalYMD,
  type EventoHistorialCompra,
  type TipoEventoCompra,
} from '../lib/comprasHistorico';

const usd = (n: number) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const pad2 = (n: number) => String(n).padStart(2, '0');
const hoyLocalYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
function sumarDiasYMD(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + dias);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function metaVisualEventoCompra(
  tipo: TipoEventoCompra,
  colors: any
): { icon: string; badge: string; accionPorLabel: string; bg: string; border: string; text: string } {
  switch (tipo) {
    case 'items_modificados':
      return {
        icon: '✏️',
        badge: 'ÍTEMS MODIFICADOS',
        accionPorLabel: 'Ítems modificados por:',
        bg: colors.warningSoftBg,
        border: colors.warningSoftBorder,
        text: colors.warningSoftText,
      };
    case 'enviado_por_pagar':
      return {
        icon: '📤',
        badge: 'ENVIADO A POR PAGAR',
        accionPorLabel: 'Enviado a Por Pagar por:',
        bg: colors.infoSoftBg,
        border: colors.infoSoftBorder,
        text: colors.infoSoftText,
      };
    case 'aprobado_gerencia_cxp':
    case 'aprobacion_gerencial':
      return {
        icon: '👔',
        badge: 'AUTORIZADO POR APROBADOR',
        accionPorLabel: 'Autorizado para pago por:',
        bg: colors.successSoftBg,
        border: colors.successSoftBorder,
        text: colors.successSoftText,
      };
    case 'pago_completado':
    case 'pagado_completo':
      return {
        icon: '✅',
        badge: 'PAGO LIQUIDADO',
        accionPorLabel: 'Marcado como pagada por:',
        bg: colors.successSoftBg,
        border: colors.successSoftBorder,
        text: colors.successSoftText,
      };
    case 'abono_registrado':
    case 'pago_registrado':
      return {
        icon: '💵',
        badge: 'ABONO REGISTRADO',
        accionPorLabel: 'Abono registrado por:',
        bg: colors.infoSoftBg,
        border: colors.infoSoftBorder,
        text: colors.infoSoftText,
      };
    case 'factura_registrada':
    case 'factura_adjuntada':
      return {
        icon: '🧾',
        badge: 'FACTURA CARGADA',
        accionPorLabel: 'Factura cargada por:',
        bg: colors.surfaceAlt,
        border: colors.brand,
        text: colors.brandText,
      };
    case 'rechazado_o_anulado':
      return {
        icon: '⛔',
        badge: 'RECHAZADO / ANULADO',
        accionPorLabel: 'Rechazado / Anulado por:',
        bg: colors.dangerSoftBg,
        border: colors.dangerSoftBorder,
        text: colors.dangerSoftText,
      };
    case 'aclaratoria_pedida':
    case 'aclaratoria_respondida':
      return {
        icon: '💬',
        badge: tipo === 'aclaratoria_pedida' ? 'ACLARATORIA PEDIDA' : 'ACLARATORIA RESPONDIDA',
        accionPorLabel: tipo === 'aclaratoria_pedida' ? 'Aclaratoria pedida por:' : 'Respondido por:',
        bg: colors.warningSoftBg,
        border: colors.warningSoftBorder,
        text: colors.warningSoftText,
      };
    case 'recepcion_almacen':
    case 'despacho_almacen':
      return {
        icon: '📦',
        badge: tipo === 'recepcion_almacen' ? 'RECIBIDO EN ALMACÉN' : 'DESPACHADO DE ALMACÉN',
        accionPorLabel: tipo === 'recepcion_almacen' ? 'Recibido en almacén por:' : 'Despachado por:',
        bg: colors.successSoftBg,
        border: colors.successSoftBorder,
        text: colors.successSoftText,
      };
    default:
      return {
        icon: '📝',
        badge: tipo === 'convertido_req' ? 'CONVERTIDO A REQ.' : 'SOLICITUD / REQUERIMIENTO',
        accionPorLabel: tipo === 'convertido_req' ? 'Convertido a Req. por:' : 'Registrado por:',
        bg: colors.surfaceAlt,
        border: colors.border,
        text: colors.text,
      };
  }
}

/**
 * Bloque plegable de línea de tiempo reutilizable dentro de cualquier tarjeta de Por Pagar o Requerimiento.
 */
export function TimelineExpedienteBox({
  eventos,
  defaultOpen = false,
  titulo,
}: {
  eventos: EventoHistorialCompra[];
  defaultOpen?: boolean;
  titulo?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  if (!eventos || eventos.length === 0) return null;

  const modsCount = eventos.filter((e) => e.tipo === 'items_modificados').length;
  const ordenadosDesc = eventos
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <View
      style={{
        marginTop: spacing.xs,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: modsCount > 0 ? colors.warningSoftBorder : colors.border,
        backgroundColor: colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.75}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
          paddingHorizontal: spacing.sm,
          paddingVertical: 7,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 12 }}>
            📜 Histórico de movimientos ({eventos.length})
          </Text>
          {modsCount > 0 ? (
            <View
              style={{
                backgroundColor: colors.warningSoftBg,
                borderWidth: 1,
                borderColor: colors.warningSoftBorder,
                borderRadius: radius.pill,
                paddingHorizontal: 8,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: colors.warningSoftText, fontSize: 10.5, fontWeight: '900' }}>
                ✏️ {modsCount} modificación{modsCount === 1 ? '' : 'es'} de ítems
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
          {open ? '▲ Ocultar histórico' : '▼ Ver movimientos detallados'}
        </Text>
      </TouchableOpacity>

      {open ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            padding: spacing.sm,
            gap: 8,
            backgroundColor: colors.surface,
          }}
        >
          {ordenadosDesc.map((ev, idx) => {
            const meta = metaVisualEventoCompra(ev.tipo, colors);
            return (
              <View
                key={ev.id || idx}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: meta.border,
                  paddingLeft: spacing.sm,
                  paddingVertical: 4,
                  backgroundColor: ev.tipo === 'items_modificados' ? colors.warningSoftBg : colors.surfaceAlt,
                  borderRadius: radius.sm,
                  paddingRight: spacing.sm,
                  gap: 3,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <View
                      style={{
                        backgroundColor: meta.bg,
                        borderWidth: 1,
                        borderColor: meta.border,
                        borderRadius: radius.pill,
                        paddingHorizontal: 7,
                        paddingVertical: 1,
                      }}
                    >
                      <Text style={{ color: meta.text, fontSize: 10, fontWeight: '900' }}>
                        {meta.icon} {meta.badge}
                      </Text>
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                      {ev.titulo}
                      {ev.by && !ev.titulo.toLowerCase().includes(ev.by.toLowerCase()) ? (
                        <Text style={{ color: colors.brandText, fontWeight: '900' }}> · por {ev.by}</Text>
                      ) : null}
                    </Text>
                  </View>
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '800' }}>
                    📅 {fmtFechaCorta(ev.at)}
                    {fmtSoloHora(ev.at) ? (
                      <Text style={{ color: colors.brandText, fontWeight: '900' }}> · 🕒 {fmtSoloHora(ev.at)}</Text>
                    ) : null}
                  </Text>
                </View>

                <Text style={{ color: colors.text, fontSize: 11.5 }}>
                  👤 <Text style={{ fontWeight: '800' }}>{meta.accionPorLabel}</Text>{' '}
                  <Text style={{ color: colors.brandText, fontWeight: '900' }}>{ev.by}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {' · '}🕒 Hora: {fmtSoloHora(ev.at) || fmtFechaHora(ev.at)}
                  </Text>
                  <Text style={{ color: colors.muted }}> · Módulo: {ev.modulo}</Text>
                </Text>

                <Text style={{ color: colors.text, fontSize: 12, lineHeight: 17 }}>{ev.detalle}</Text>

                {/* Desglose línea por línea cuando hubo modificación de ítems */}
                {ev.cambiosItems && ev.cambiosItems.length > 0 ? (
                  <View
                    style={{
                      marginTop: 4,
                      padding: 6,
                      borderRadius: radius.sm,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      gap: 4,
                    }}
                  >
                    {ev.montoAntesUsd != null && ev.montoDespuesUsd != null ? (
                      <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>
                        💵 Monto anterior: {usd(ev.montoAntesUsd)} ➔ Nuevo monto:{' '}
                        <Text style={{ color: colors.brandText, fontWeight: '900' }}>
                          {usd(ev.montoDespuesUsd)} USD
                        </Text>
                      </Text>
                    ) : null}
                    {ev.cambiosItems.map((ci, ciIdx) => {
                      const icono =
                        ci.accion === 'eliminado'
                          ? '🔴 Quitado:'
                          : ci.accion === 'agregado'
                            ? '🟢 Agregado:'
                            : '🟡 Modificado:';
                      const colorAccion =
                        ci.accion === 'eliminado'
                          ? colors.dangerSoftText
                          : ci.accion === 'agregado'
                            ? colors.successSoftText
                            : colors.warningSoftText;
                      return (
                        <Text key={ciIdx} style={{ color: colors.text, fontSize: 11.5 }}>
                          <Text style={{ color: colorAccion, fontWeight: '900' }}>{icono} </Text>
                          {ci.resumen}
                        </Text>
                      );
                    })}
                    {ev.motivo ? (
                      <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>
                        📝 Motivo: {ev.motivo}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

type ModoFechaHist = 'todas' | 'hoy' | 'ayer' | '7dias' | 'mes' | 'dia' | 'rango';
type FiltroTipoHist =
  | 'todos'
  | 'items_modificados'
  | 'enviado_por_pagar'
  | 'aprobado_gerencia_cxp'
  | 'pagos_y_facturas'
  | 'solicitudes_y_req'
  | 'almacen';

export function HistoricoComprasTab() {
  const { colors } = useTheme();
  const hoy = hoyLocalYMD();

  const { data: requirements, loading: loadingReqs, refetch: refetchReqs } = useTable<InventoryRequirement>(
    'inventory_requirements',
    { orderBy: 'created_at', ascending: false }
  );
  const { data: cuentas, loading: loadingCuentas, refetch: refetchCuentas } = useTable<Cuenta>('cuentas', {
    orderBy: 'created_at',
    ascending: false,
  });
  const { data: abonos, refetch: refetchAbonos } = useTable<CuentaAbono>('cuenta_abonos', {
    orderBy: 'fecha',
    ascending: false,
  });
  const { data: orders } = useTable<PurchaseOrder>('purchase_orders', {
    orderBy: 'created_at',
    ascending: false,
  });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: vehicles } = useTable<Vehicle>('vehicles', { orderBy: 'plate' });

  const [usuariosMap, setUsuariosMap] = useState<Map<string, string>>(new Map());
  const [auditLogsCompra, setAuditLogsCompra] = useState<AuditLog[]>([]);

  const cargarPerfilesYAuditoria = React.useCallback(async () => {
    try {
      const [resProf, resAudit] = await Promise.all([
        supabase.from('profiles').select('id, full_name, username'),
        supabase
          .from('audit_log')
          .select('id, at, user_id, user_name, action, table_name, row_id, changes')
          .in('table_name', ['inventory_requirements', 'cuentas', 'cuenta_abonos'])
          .in('action', ['INSERT', 'UPDATE', 'DELETE'])
          .order('at', { ascending: true })
          .limit(4000),
      ]);

      const m = new Map<string, string>();
      let profRows = resProf.data as any[] | null;
      if (!profRows && resProf.error) {
        const fallbackProf = await supabase.from('profiles').select('id, full_name');
        profRows = fallbackProf.data as any[] | null;
      }
      (profRows || []).forEach((p) => {
        const n = String(p.full_name || p.username || '').trim();
        if (p.id && n) m.set(String(p.id), n);
      });

      const logs = (resAudit.data as AuditLog[] | null) || [];
      logs.forEach((l) => {
        const n = String(l.user_name || '').trim();
        if (l.user_id && n && !m.has(String(l.user_id))) {
          m.set(String(l.user_id), n);
        }
      });

      setUsuariosMap(m);
      setAuditLogsCompra(logs);
    } catch {}
  }, []);

  useEffect(() => {
    cargarPerfilesYAuditoria();
  }, [cargarPerfilesYAuditoria]);

  const [vistaModo, setVistaModo] = useState<'bitacora' | 'expedientes'>('bitacora');
  const [q, setQ] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipoHist>('todos');
  const [modoFecha, setModoFecha] = useState<ModoFechaHist>('todas');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  // Construir todos los expedientes y el feed global de eventos
  const { todosEventos, expedientes } = useMemo(() => {
    // Mapa enriquecido de usuarios (perfiles + audit_log + nombres guardados en requerimientos)
    const mapaUsuariosCompleto = new Map<string, string>(usuariosMap);
    (requirements || []).forEach((r) => {
      if (r.requested_by && r.requested_by_name && !mapaUsuariosCompleto.has(String(r.requested_by))) {
        mapaUsuariosCompleto.set(String(r.requested_by), r.requested_by_name.trim());
      }
      if (r.decided_by && r.decided_by_name && !mapaUsuariosCompleto.has(String(r.decided_by))) {
        mapaUsuariosCompleto.set(String(r.decided_by), r.decided_by_name.trim());
      }
      if (r.responsable_id && r.responsable_nombre && !mapaUsuariosCompleto.has(String(r.responsable_id))) {
        mapaUsuariosCompleto.set(String(r.responsable_id), r.responsable_nombre.trim());
      }
      if (r.motorizado_user_id && r.motorizado_nombre && !mapaUsuariosCompleto.has(String(r.motorizado_user_id))) {
        mapaUsuariosCompleto.set(String(r.motorizado_user_id), r.motorizado_nombre.trim());
      }
    });

    // Índice de audit_log por row_id para acceso O(1)
    const logsPorRowId = new Map<string, AuditLog[]>();
    (auditLogsCompra || []).forEach((l) => {
      if (!l.row_id) return;
      const k = String(l.row_id);
      const arr = logsPorRowId.get(k) ?? [];
      arr.push(l);
      logsPorRowId.set(k, arr);
    });

    const abonosPorCuenta = new Map<string, CuentaAbono[]>();
    (abonos || []).forEach((ab) => {
      const arr = abonosPorCuenta.get(ab.cuenta_id) ?? [];
      arr.push(ab);
      abonosPorCuenta.set(ab.cuenta_id, arr);
    });

    const cuentaPorReqId = new Map<string, Cuenta>();
    const cuentasSinReq: Cuenta[] = [];
    (cuentas || [])
      .filter((c) => c.tipo === 'por_pagar')
      .forEach((c) => {
        const reqVinc = resolverRequerimientoVinculadoACuenta(c, requirements, orders);
        const targetReqId = c.inventory_requirement_id || reqVinc?.id || null;
        if (targetReqId) {
          const existente = cuentaPorReqId.get(targetReqId);
          // Si hubiera más de una cuenta ligada al mismo req, priorizar la pagada o la más reciente
          if (!existente || (c.estado === 'pagada' && existente.estado !== 'pagada')) {
            cuentaPorReqId.set(targetReqId, c);
          }
        } else {
          cuentasSinReq.push(c);
        }
      });

    const listaEv: EventoHistorialCompra[] = [];
    const listaExp: Array<{
      key: string;
      codigo: string;
      titulo: string;
      solicitante: string;
      destino: string | null;
      empresa: string | null;
      proveedor: string | null;
      ultimaFecha: string;
      modificacionesCount: number;
      eventos: EventoHistorialCompra[];
    }> = [];

    (requirements || []).forEach((req) => {
      const cta = cuentaPorReqId.get(req.id) || null;
      const abs = cta ? abonosPorCuenta.get(cta.id) || [] : [];
      const logsExp: AuditLog[] = [
        ...(logsPorRowId.get(req.id) || []),
        ...(cta ? logsPorRowId.get(cta.id) || [] : []),
        ...abs.flatMap((a) => logsPorRowId.get(a.id) || []),
      ];
      const evs = construirTimelineExpediente({
        req,
        cuenta: cta,
        abonos: abs,
        companies,
        suppliers,
        machines,
        vehicles,
        usuariosMap: mapaUsuariosCompleto,
        auditLogs: logsExp,
      });
      if (evs.length > 0) {
        listaEv.push(...evs);
        const ult = evs[evs.length - 1];
        listaExp.push({
          key: `req-${req.id}`,
          codigo: req.code || 'REQ',
          titulo: req.title || `${req.items?.length || 0} renglones`,
          solicitante: ult.solicitanteNombre || req.solicitante_nombre || req.requested_by_name || '—',
          destino: ult.destinoTexto || null,
          empresa: ult.empresaNombre || null,
          proveedor: ult.proveedorNombre || null,
          ultimaFecha: ult.at,
          modificacionesCount: evs.filter((e) => e.tipo === 'items_modificados').length,
          eventos: evs,
        });
      }
    });

    cuentasSinReq.forEach((cta) => {
      const abs = abonosPorCuenta.get(cta.id) || [];
      const logsExp: AuditLog[] = [
        ...(logsPorRowId.get(cta.id) || []),
        ...abs.flatMap((a) => logsPorRowId.get(a.id) || []),
      ];
      const evs = construirTimelineExpediente({
        req: null,
        cuenta: cta,
        abonos: abs,
        companies,
        suppliers,
        machines,
        vehicles,
        usuariosMap: mapaUsuariosCompleto,
        auditLogs: logsExp,
      });
      if (evs.length > 0) {
        listaEv.push(...evs);
        const ult = evs[evs.length - 1];
        listaExp.push({
          key: `cta-${cta.id}`,
          codigo: cta.documento || 'CXP',
          titulo: cta.concepto || 'Cuenta por pagar',
          solicitante: ult.solicitanteNombre || 'Administración',
          destino: ult.destinoTexto || null,
          empresa: ult.empresaNombre || null,
          proveedor: ult.proveedorNombre || cta.contraparte || null,
          ultimaFecha: ult.at,
          modificacionesCount: evs.filter((e) => e.tipo === 'items_modificados').length,
          eventos: evs,
        });
      }
    });

    listaEv.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    listaExp.sort((a, b) => new Date(b.ultimaFecha).getTime() - new Date(a.ultimaFecha).getTime());

    return { todosEventos: listaEv, expedientes: listaExp };
  }, [requirements, cuentas, abonos, orders, companies, suppliers, machines, vehicles, usuariosMap, auditLogsCompra]);

  // Rango de fechas efectivo
  const rangoFecha = useMemo(() => {
    if (modoFecha === 'todas') return { desde: '', hasta: '' };
    if (modoFecha === 'hoy') return { desde: hoy, hasta: hoy };
    if (modoFecha === 'ayer') {
      const ayer = sumarDiasYMD(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    if (modoFecha === '7dias') return { desde: sumarDiasYMD(hoy, -6), hasta: hoy };
    if (modoFecha === 'mes') return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    if (modoFecha === 'dia') return { desde: fechaDesde, hasta: fechaDesde };
    return { desde: fechaDesde, hasta: fechaHasta };
  }, [modoFecha, hoy, fechaDesde, fechaHasta]);

  const pasaFecha = (iso: string) => {
    if (modoFecha === 'todas') return true;
    const ymd = toLocalYMD(iso);
    if (!ymd) return false;
    if (rangoFecha.desde && ymd < rangoFecha.desde) return false;
    if (rangoFecha.hasta && ymd > rangoFecha.hasta) return false;
    return true;
  };

  const pasaTipo = (t: TipoEventoCompra) => {
    if (filtroTipo === 'todos') return true;
    if (filtroTipo === 'items_modificados') return t === 'items_modificados';
    if (filtroTipo === 'enviado_por_pagar') return t === 'enviado_por_pagar';
    if (filtroTipo === 'aprobado_gerencia_cxp')
      return t === 'aprobado_gerencia_cxp' || t === 'aprobacion_gerencial';
    if (filtroTipo === 'pagos_y_facturas')
      return (
        t === 'pago_completado' ||
        t === 'pagado_completo' ||
        t === 'abono_registrado' ||
        t === 'pago_registrado' ||
        t === 'factura_registrada' ||
        t === 'factura_adjuntada'
      );
    if (filtroTipo === 'solicitudes_y_req')
      return (
        t === 'solicitud_creada' ||
        t === 'solicitud_editada' ||
        t === 'convertido_req' ||
        t === 'req_creado' ||
        t === 'aclaratoria_pedida' ||
        t === 'aclaratoria_respondida'
      );
    if (filtroTipo === 'almacen') return t === 'recepcion_almacen' || t === 'despacho_almacen';
    return true;
  };

  const nq = norm(q);

  const eventosFiltrados = useMemo(() => {
    return todosEventos.filter((ev) => {
      if (!pasaTipo(ev.tipo)) return false;
      if (!pasaFecha(ev.at)) return false;
      if (!nq) return true;
      const itemsTxt = (ev.cambiosItems || []).map((c) => `${c.nombre} ${c.resumen}`).join(' ');
      return matchNorm(
        nq,
        ev.reqCode,
        ev.titulo,
        ev.detalle,
        ev.by,
        ev.modulo,
        ev.empresaNombre,
        ev.proveedorNombre,
        ev.solicitanteNombre,
        ev.destinoTexto,
        ev.areaTexto,
        ev.motivo,
        itemsTxt
      );
    });
  }, [todosEventos, filtroTipo, modoFecha, rangoFecha, nq]);

  const expedientesFiltrados = useMemo(() => {
    return expedientes.filter((exp) => {
      const tieneEventoEnFiltro = exp.eventos.some((ev) => pasaTipo(ev.tipo) && pasaFecha(ev.at));
      if (!tieneEventoEnFiltro) return false;
      if (!nq) return true;
      const textoEvs = exp.eventos
        .map((e) => `${e.titulo} ${e.detalle} ${e.by} ${(e.cambiosItems || []).map((c) => c.resumen).join(' ')}`)
        .join(' ');
      return matchNorm(
        nq,
        exp.codigo,
        exp.titulo,
        exp.solicitante,
        exp.destino,
        exp.empresa,
        exp.proveedor,
        textoEvs
      );
    });
  }, [expedientes, filtroTipo, modoFecha, rangoFecha, nq]);

  const kpis = useMemo(() => {
    return {
      totalMovs: eventosFiltrados.length,
      modsItems: eventosFiltrados.filter((e) => e.tipo === 'items_modificados').length,
      enviadosCxp: eventosFiltrados.filter((e) => e.tipo === 'enviado_por_pagar').length,
      pagosYAb: eventosFiltrados.filter(
        (e) =>
          e.tipo === 'pago_completado' ||
          e.tipo === 'pagado_completo' ||
          e.tipo === 'abono_registrado' ||
          e.tipo === 'pago_registrado'
      ).length,
    };
  }, [eventosFiltrados]);

  const refrescarTodo = () => {
    refetchReqs();
    refetchCuentas();
    refetchAbonos();
    cargarPerfilesYAuditoria();
  };

  if (loadingReqs && loadingCuentas) {
    return (
      <Screen>
        <SkeletonList />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refrescarTodo} refreshing={loadingReqs || loadingCuentas}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.xs,
          marginBottom: spacing.xs,
        }}
      >
        <SectionTitle>📜 Histórico de Compras y Por Pagar</SectionTitle>

        {/* Selector de Modo de Vista */}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <TouchableOpacity
            onPress={() => setVistaModo('bitacora')}
            style={{
              backgroundColor: vistaModo === 'bitacora' ? colors.brand : colors.surfaceAlt,
              borderWidth: 1,
              borderColor: vistaModo === 'bitacora' ? colors.brand : colors.border,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                color: vistaModo === 'bitacora' ? colors.brandContrast : colors.text,
                fontWeight: '800',
                fontSize: 12,
              }}
            >
              🕒 Bitácora de Movimientos ({eventosFiltrados.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setVistaModo('expedientes')}
            style={{
              backgroundColor: vistaModo === 'expedientes' ? colors.brand : colors.surfaceAlt,
              borderWidth: 1,
              borderColor: vistaModo === 'expedientes' ? colors.brand : colors.border,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                color: vistaModo === 'expedientes' ? colors.brandContrast : colors.text,
                fontWeight: '800',
                fontSize: 12,
              }}
            >
              📁 Por Expediente ({expedientesFiltrados.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* KPIs rápidos */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        <View
          style={{
            flex: 1,
            minWidth: 135,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            padding: spacing.sm,
          }}
        >
          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800' }}>MOVIMIENTOS</Text>
          <Text style={{ color: colors.brandText, fontSize: 18, fontWeight: '900', marginTop: 2 }}>
            {kpis.totalMovs}
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            minWidth: 135,
            backgroundColor: colors.warningSoftBg,
            borderWidth: 1,
            borderColor: colors.warningSoftBorder,
            borderRadius: radius.md,
            padding: spacing.sm,
          }}
        >
          <Text style={{ color: colors.warningSoftText, fontSize: 10.5, fontWeight: '800' }}>
            ✏️ MODIFICACIÓN DE ÍTEMS
          </Text>
          <Text style={{ color: colors.warningSoftText, fontSize: 18, fontWeight: '900', marginTop: 2 }}>
            {kpis.modsItems}
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            minWidth: 135,
            backgroundColor: colors.infoSoftBg,
            borderWidth: 1,
            borderColor: colors.infoSoftBorder,
            borderRadius: radius.md,
            padding: spacing.sm,
          }}
        >
          <Text style={{ color: colors.infoSoftText, fontSize: 10.5, fontWeight: '800' }}>
            📤 ENVIADOS A POR PAGAR
          </Text>
          <Text style={{ color: colors.infoSoftText, fontSize: 18, fontWeight: '900', marginTop: 2 }}>
            {kpis.enviadosCxp}
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            minWidth: 135,
            backgroundColor: colors.successSoftBg,
            borderWidth: 1,
            borderColor: colors.successSoftBorder,
            borderRadius: radius.md,
            padding: spacing.sm,
          }}
        >
          <Text style={{ color: colors.successSoftText, fontSize: 10.5, fontWeight: '800' }}>
            ✅ PAGOS Y ABONOS
          </Text>
          <Text style={{ color: colors.successSoftText, fontSize: 18, fontWeight: '900', marginTop: 2 }}>
            {kpis.pagosYAb}
          </Text>
        </View>
      </View>

      {/* Filtro de Fechas (Día exacto o Rango Desde / Hasta) */}
      <View
        style={{
          marginBottom: spacing.xs,
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.xs,
          gap: 6,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {(
            [
              ['todas', '📅 Todas las fechas'],
              ['hoy', 'Hoy'],
              ['ayer', 'Ayer'],
              ['7dias', 'Últimos 7 días'],
              ['mes', 'Este mes'],
              ['dia', '📆 Fecha específica'],
              ['rango', '🗓️ Rango (Desde — Hasta)'],
            ] as const
          ).map(([k, label]) => {
            const on = modoFecha === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => {
                  setModoFecha(k);
                  if (k === 'dia' && !fechaDesde) setFechaDesde(hoy);
                  if (k === 'rango' && !fechaDesde) {
                    setFechaDesde(sumarDiasYMD(hoy, -7));
                    setFechaHasta(hoy);
                  }
                }}
                style={{
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? colors.brand : colors.border,
                  backgroundColor: on ? colors.brand : colors.surface,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11.5 }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {modoFecha !== 'todas' ? (
            <TouchableOpacity
              onPress={() => {
                setModoFecha('todas');
                setFechaDesde('');
                setFechaHasta('');
              }}
              style={{
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.danger,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.sm,
                paddingVertical: 5,
              }}
            >
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11.5 }}>✕ Limpiar fecha</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>

        {modoFecha === 'dia' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>Fecha exacta:</Text>
            <View style={{ flex: 1, minWidth: 170, maxWidth: 260 }}>
              <DateField value={fechaDesde} onChange={setFechaDesde} placeholder="AAAA-MM-DD" />
            </View>
          </View>
        ) : modoFecha === 'rango' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 150 }}>
              <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginBottom: 2 }}>DESDE</Text>
              <DateField value={fechaDesde} onChange={setFechaDesde} placeholder="Desde (AAAA-MM-DD)" />
            </View>
            <View style={{ flex: 1, minWidth: 150 }}>
              <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginBottom: 2 }}>HASTA</Text>
              <DateField value={fechaHasta} onChange={setFechaHasta} placeholder="Hasta (AAAA-MM-DD)" />
            </View>
          </View>
        ) : null}
      </View>

      {/* Chips de tipo de movimiento */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingVertical: 4, marginBottom: spacing.xs }}
      >
        {(
          [
            ['todos', 'Todos los movimientos'],
            ['items_modificados', '✏️ Modificaciones de Ítems'],
            ['enviado_por_pagar', '📤 Enviados a Por Pagar'],
            ['aprobado_gerencia_cxp', '👔 Autorizaciones Gerenciales'],
            ['pagos_y_facturas', '💳 Pagos, Abonos y Facturas'],
            ['solicitudes_y_req', '📝 Solicitudes y Requerimientos'],
            ['almacen', '📦 Recepción y Despacho'],
          ] as const
        ).map(([k, label]) => {
          const on = filtroTipo === k;
          return (
            <TouchableOpacity
              key={k}
              onPress={() => setFiltroTipo(k)}
              style={{
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: on ? colors.brand : colors.border,
                backgroundColor: on ? colors.brand : colors.surface,
                paddingHorizontal: spacing.md,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Buscador */}
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔍 Buscar por REQ-XXXX, usuario (ej. Jesús Lozada), ítem quitado/agregado, proveedor, máquina o placa…"
        placeholderTextColor={colors.muted}
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.sm,
          color: colors.text,
          marginBottom: spacing.sm,
        }}
      />

      {vistaModo === 'bitacora' ? (
        eventosFiltrados.length === 0 ? (
          <EmptyState
            title="Sin movimientos en este filtro"
            subtitle="Prueba cambiando el rango de fechas o el texto de búsqueda."
          />
        ) : (
          eventosFiltrados.map((ev, idx) => {
            const meta = metaVisualEventoCompra(ev.tipo, colors);
            return (
              <Card
                key={ev.id || idx}
                style={{
                  borderLeftWidth: 4,
                  borderLeftColor: meta.border,
                  marginBottom: spacing.xs,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <View
                      style={{
                        backgroundColor: meta.bg,
                        borderWidth: 1,
                        borderColor: meta.border,
                        borderRadius: radius.pill,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={{ color: meta.text, fontSize: 10.5, fontWeight: '900' }}>
                        {meta.icon} {meta.badge}
                      </Text>
                    </View>
                    {ev.reqCode ? (
                      <View
                        style={{
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.sm,
                          paddingHorizontal: 7,
                          paddingVertical: 2,
                        }}
                      >
                        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }}>
                          {ev.reqCode}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                      {ev.titulo}
                      {ev.by && !ev.titulo.toLowerCase().includes(ev.by.toLowerCase()) ? (
                        <Text style={{ color: colors.brandText, fontWeight: '900' }}> · por {ev.by}</Text>
                      ) : null}
                    </Text>
                  </View>

                  <View
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.pill,
                      paddingHorizontal: 9,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>
                      📅 {fmtFechaCorta(ev.at)}
                      {fmtSoloHora(ev.at) ? (
                        <Text style={{ color: colors.brandText, fontWeight: '900' }}>
                          {' · '}🕒 {fmtSoloHora(ev.at)}
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                </View>

                {/* Contexto del expediente */}
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 10,
                    marginTop: 5,
                    paddingVertical: 4,
                    paddingHorizontal: 8,
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 11.5 }}>
                    👤 <Text style={{ fontWeight: '700' }}>{meta.accionPorLabel}</Text>{' '}
                    <Text style={{ color: colors.brandText, fontWeight: '900' }}>{ev.by}</Text>
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 11.5 }}>
                    🕒 <Text style={{ fontWeight: '700' }}>Hora:</Text>{' '}
                    <Text style={{ color: colors.text, fontWeight: '900' }}>
                      {fmtSoloHora(ev.at)
                        ? `${fmtSoloHora(ev.at)} (${fmtFechaCorta(ev.at)})`
                        : fmtFechaHora(ev.at)}
                    </Text>
                  </Text>
                  {ev.solicitanteNombre ? (
                    <Text style={{ color: colors.text, fontSize: 11.5 }}>
                      🙋 <Text style={{ fontWeight: '700' }}>Solicitó:</Text> {ev.solicitanteNombre}
                    </Text>
                  ) : null}
                  {ev.destinoTexto ? (
                    <Text style={{ color: colors.text, fontSize: 11.5 }}>
                      🚜 <Text style={{ fontWeight: '700' }}>Para / Destino:</Text>{' '}
                      <Text style={{ color: colors.brandText, fontWeight: '800' }}>{ev.destinoTexto}</Text>
                    </Text>
                  ) : null}
                  {ev.proveedorNombre ? (
                    <Text style={{ color: colors.text, fontSize: 11.5 }}>
                      🏭 <Text style={{ fontWeight: '700' }}>Proveedor:</Text> {ev.proveedorNombre}
                    </Text>
                  ) : null}
                  {ev.empresaNombre ? (
                    <Text style={{ color: colors.text, fontSize: 11.5 }}>
                      🏢 <Text style={{ fontWeight: '700' }}>Empresa:</Text> {ev.empresaNombre}
                    </Text>
                  ) : null}
                </View>

                <Text style={{ color: colors.text, fontSize: 12.5, marginTop: 6, lineHeight: 18 }}>
                  {ev.detalle}
                </Text>

                {/* Desglose detallado de ítems agregados/quitados/modificados */}
                {ev.cambiosItems && ev.cambiosItems.length > 0 ? (
                  <View
                    style={{
                      marginTop: 6,
                      padding: 8,
                      borderRadius: radius.sm,
                      backgroundColor: colors.warningSoftBg,
                      borderWidth: 1,
                      borderColor: colors.warningSoftBorder,
                      gap: 4,
                    }}
                  >
                    {ev.montoAntesUsd != null && ev.montoDespuesUsd != null ? (
                      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>
                        💵 Monto anterior: {usd(ev.montoAntesUsd)} USD ➔ Nuevo monto:{' '}
                        <Text style={{ color: colors.brandText }}>{usd(ev.montoDespuesUsd)} USD</Text>
                      </Text>
                    ) : null}
                    {ev.cambiosItems.map((ci, ciIdx) => {
                      const icono =
                        ci.accion === 'eliminado'
                          ? '🔴 Quitado:'
                          : ci.accion === 'agregado'
                            ? '🟢 Agregado:'
                            : '🟡 Modificado:';
                      return (
                        <Text key={ciIdx} style={{ color: colors.text, fontSize: 12 }}>
                          <Text style={{ fontWeight: '900' }}>{icono} </Text>
                          {ci.resumen}
                        </Text>
                      );
                    })}
                    {ev.motivo ? (
                      <Text style={{ color: colors.text, fontSize: 11.5, fontStyle: 'italic', marginTop: 2 }}>
                        📝 Motivo registrado: {ev.motivo}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            );
          })
        )
      ) : expedientesFiltrados.length === 0 ? (
        <EmptyState
          title="Sin expedientes en este filtro"
          subtitle="Prueba con otra búsqueda o rango de fechas."
        />
      ) : (
        expedientesFiltrados.map((exp) => (
          <Card key={exp.key} style={{ marginBottom: spacing.xs }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 14, flex: 1 }}>
                {exp.codigo} · {exp.titulo}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                Últ. mov.: {fmtFechaHora(exp.ultimaFecha)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
              <Text style={{ color: colors.text, fontSize: 12 }}>
                👤 <Text style={{ fontWeight: '700' }}>Solicitado por:</Text> {exp.solicitante}
              </Text>
              {exp.destino ? (
                <Text style={{ color: colors.text, fontSize: 12 }}>
                  🚜 <Text style={{ fontWeight: '700' }}>Para:</Text>{' '}
                  <Text style={{ color: colors.brandText, fontWeight: '800' }}>{exp.destino}</Text>
                </Text>
              ) : null}
              {exp.proveedor ? (
                <Text style={{ color: colors.text, fontSize: 12 }}>
                  🏭 <Text style={{ fontWeight: '700' }}>Proveedor:</Text> {exp.proveedor}
                </Text>
              ) : null}
              {exp.empresa ? (
                <Text style={{ color: colors.text, fontSize: 12 }}>
                  🏢 <Text style={{ fontWeight: '700' }}>Empresa:</Text> {exp.empresa}
                </Text>
              ) : null}
            </View>

            <TimelineExpedienteBox eventos={exp.eventos} defaultOpen={exp.modificacionesCount > 0} />
          </Card>
        ))
      )}
    </Screen>
  );
}

