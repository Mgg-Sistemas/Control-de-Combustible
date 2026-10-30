// ── CUENTAS POR PAGAR Y POR COBRAR ───────────────────────────────────────────
// Pedido del cliente: "en compras hay que hacer el apartado o una forma de
// cuentas por pagar y cuentas por cobrar".
//
// Una cuenta = una DEUDA VIVA. Las dos pestañas son el MISMO componente con el
// `tipo` cambiado ('por_pagar' | 'por_cobrar'), porque los campos, los totales y
// la aritmética son idénticos — lo único que cambia es de qué lado del dinero
// está la fila (ver la justificación larga en supabase/cuentas_por_pagar_y_cobrar.sql).
//
// Tablas: `cuentas` + `cuenta_abonos` (las crea ese .sql, que hay que correr A
// MANO en Supabase). La contraparte NO se teclea: se ELIGE de los maestros que
// ya existen y tienen datos reales — `suppliers` (6) para lo que se paga y
// `companies` (11) para lo que se cobra — y en la base solo se guarda su id, de
// modo que corregir un nombre allá corrige todas sus deudas aquí. Esta pantalla
// LEE esos maestros; NO escribe en ellos ni en Compras.
//
// El módulo se llama 'cuentas' y NACE CERRADO: nadie lo ve hasta que un
// administrador le dé el permiso desde Usuarios.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { Cuenta, CuentaAbono, CuentaTipo, Supplier, Company, PurchaseOrder, InventoryRequirement, Machinery, Vehicle, RequirementLine } from '../types/database';
import { DateField } from '../components/DateField';
import {
  resolverTrazabilidadPorPagar,
  anexarEventoHistorial,
  preservarHistorialYEnvioEnTexto,
  calcularDiffItemsCompra,
  construirTimelineExpediente,
  type TrazabilidadPorPagar,
} from '../lib/comprasHistorico';
import { TimelineExpedienteBox } from './HistoricoComprasTab';
import { generalCompanies } from '../lib/companies';
import {
  ID_SIN_EMPRESA,
  NOMBRE_SIN_EMPRESA,
  InfoEmpresaCuenta,
  resolverEmpresaDeCuenta,
  inyectarEmpresaEnNota,
  extraerEmpresaDeNota,
  pasaFiltroEmpresas,
} from '../lib/cuentasEmpresa';
import {
  pickAndUploadDocFile,
  pickAndUploadDocFiles,
  takeAndUploadDocPhoto,
  takePhotoAndUpload,
} from '../lib/photo';
import {
  FormatoAdjunto,
  extraerFormatosAdjuntos,
  empaquetarFormatosEnObservaciones,
  limpiarObservacionesFormatos,
} from '../lib/formatosAdjuntos';
import { exportPdf } from '../lib/pdf';
import { reciboCuentaHtml } from '../lib/reciboCuenta';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { matchNorm, norm, cmpText } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { useBcvRate, fmtBs, bsFromUsd } from '../lib/bcv';
import {
  extraerReciboPagoCuenta,
  inyectarReciboPagoEnNota,
  extraerComprobanteAbono,
  inyectarComprobanteEnAbonoNota,
  extraerFacturaCuenta,
  inyectarFacturaEnCuentaNota,
  extraerAprobacionCxp,
  inyectarAprobacionCxpEnNota,
  limpiarNotaCuentasVisual,
  CONDICIONES_PAGO_CHIPS,
  detectarDiasCreditoChip,
  toggleChipCondicionPago,
  inyectarCondicionesPagoEnNota,
  resolverCondicionesYNotaCuenta,
  resolverInfoMetodoPagoPorPagar,
  type ReciboPagoInfo,
  type AprobacionCxpInfo,
  type ArchivoSoporte,
  type FacturaData,
  type InfoMetodoPagoPorPagar,
} from '../lib/cuentasPago';
import {
  extraerCapturaPago,
  limpiarNotasUsuario,
  empaquetarNotasConCaptura,
} from '../lib/proveedorPago';
import {
  extraerReciboPago,
  inyectarReciboPagoEnObservaciones,
  extraerFactura,
  inyectarFacturaEnObservaciones,
} from '../lib/requerimientoExpediente';
import {
  obtenerConfigAprobacionMonto,
  guardarConfigAprobacionMonto,
  esUsuarioAutorizadoConfigAprobacion,
  puedeUsuarioAprobarRequerimiento,
  type ReglaAprobacionMonto,
} from '../lib/requerimientoFlujo';
import { ReporteCuentasModal } from '../components/ReporteCuentasModal';

// Grado de prioridad (opcional). Orden de urgencia: alta > media > baja > (sin).
type Prioridad = 'alta' | 'media' | 'baja';
const PRIORIDAD_INFO: Record<Prioridad, { label: string; tone: 'danger' | 'warning' | 'info' }> = {
  alta:  { label: '🔺 Alta',  tone: 'danger'  },
  media: { label: '🔸 Media', tone: 'warning' },
  baja:  { label: '🔹 Baja',  tone: 'info'    },
};
const PRIORIDAD_RANK: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// ⚠️ 19-sep-2026: antes botaba la coma («100,50» se guardaba como 10050). Ahora punto
//    y coma valen igual; la regla vive en src/lib/numeros.ts.
const parseNum = leerNumero;
const nowISO = () => new Date().toISOString();

// ── Fechas ───────────────────────────────────────────────────────────────────
// Las columnas `fecha_emision` / `fecha_vencimiento` son `date` (texto
// 'AAAA-MM-DD'), así que se comparan como TEXTO: es exacto y no sufre husos
// horarios (que es justo lo que descuadraría un `new Date()` a medianoche).
const pad2 = (n: number) => String(n).padStart(2, '0');
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
/** 'AAAA-MM-DD' + n días → 'AAAA-MM-DD'. */
function masDias(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, (m || 1) - 1, d || 1);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (como se lee aquí). */
const fmtFecha = (iso: string | null) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
/** Días entre dos fechas 'AAAA-MM-DD' (b − a). Negativo = `b` ya pasó. */
function diasEntre(a: string, b: string) {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };
  return Math.round((p(b) - p(a)) / 86400000);
}
/** Valida que el texto tecleado sea una fecha 'AAAA-MM-DD' real. */
const fechaValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ── Configuración de cada pestaña ────────────────────────────────────────────
// Todo lo que cambia entre "por pagar" y "por cobrar" vive AQUÍ, para que el
// resto de la pantalla no tenga un solo `if (tipo === ...)` regado.
const TIPO_CFG: Record<CuentaTipo, {
  label: string; icon: string; contraparteLabel: string; contraparteHint: string; maestro: 'suppliers' | 'companies';
}> = {
  por_pagar: {
    label: 'Por pagar', icon: '💸',
    contraparteLabel: 'Proveedor · a quién le debemos',
    contraparteHint: 'Toca el proveedor. Si no está en la lista, regístralo primero en Compras → Proveedores.',
    maestro: 'suppliers',
  },
  por_cobrar: {
    label: 'Por cobrar', icon: '💰',
    contraparteLabel: 'Empresa · quién nos debe',
    contraparteHint: 'Toca la empresa que debe. Las empresas se administran en su propio módulo.',
    maestro: 'companies',
  },
};

type Tone = 'info' | 'warning' | 'danger' | 'success';
/** Resuelve un tono de estado a su terna Soft (fondo · borde · texto) del tema. */
function toneSoft(colors: any, tone: Tone) {
  switch (tone) {
    case 'success': return { bg: colors.successSoftBg, border: colors.successSoftBorder, text: colors.successSoftText };
    case 'warning': return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText };
    case 'danger': return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText };
    default: return { bg: colors.infoSoftBg, border: colors.infoSoftBorder, text: colors.infoSoftText };
  }
}

/** Etiqueta de estado (badge Soft): fondo tenue + borde + texto legible. */
function Pill({ label, bg, border, text }: { label: string; bg: string; border: string; text: string }) {
  return (
    <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: text, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

// ── Situación de una cuenta (lo que decide color, orden y totales) ───────────
type Situacion = 'pagada' | 'anulada' | 'vencida' | 'por_vencer' | 'pendiente';
const SIT_INFO: Record<Situacion, { label: string; tone: Tone }> = {
  pagada:     { label: '✅ Pagada',    tone: 'success' },
  anulada:    { label: '⛔ Anulada',   tone: 'danger'  },
  vencida:    { label: '🔴 Vencida',   tone: 'danger'  },
  por_vencer: { label: '🟠 Por vencer', tone: 'warning' },
  pendiente:  { label: '🕓 Pendiente', tone: 'info'    },
};
/** Ventana de "por vencer": vence dentro de los próximos 7 días. */
const DIAS_POR_VENCER = 7;

/** Desglose financiero detallado de IVA para Cuentas por Pagar */
export interface DesgloseIvaCuenta {
  subtotal: number;
  exento: number;
  baseImponible: number;
  alicuota: number;
  montoIva: number;
  total: number;
  tieneIva: boolean;
}

export function resolverDesgloseIvaCuenta(
  c: Cuenta,
  reqVinc?: InventoryRequirement | null,
  tasaBcv?: number | null
): DesgloseIvaCuenta {
  const montoCuenta = Number(c.monto) || 0;
  if (reqVinc && Array.isArray(reqVinc.items) && reqVinc.items.length > 0) {
    const rate = Number(tasaBcv) || 1;
    const lineTotalUsd = (it: RequirementLine) => {
      if (it.modo_precio === 'total' && it.total_usd != null && Number(it.total_usd) > 0) {
        return Number(it.total_usd);
      }
      const q = Number(it.qty) || 0;
      const estPrice = Number(it.est_price) || 0;
      const priceUsd = it.currency === 'USD' ? estPrice : estPrice / rate;
      return priceUsd * q;
    };
    const subtotal = Math.round(reqVinc.items.reduce((s, it) => s + lineTotalUsd(it), 0) * 100) / 100;
    const exento = Math.round(reqVinc.items.reduce((s, it) => it.exento ? s + lineTotalUsd(it) : s, 0) * 100) / 100;
    const baseImponible = Math.max(0, Math.round((subtotal - exento) * 100) / 100);
    const alicuota = reqVinc.iva_alicuota != null ? Number(reqVinc.iva_alicuota) : (c.alicuota_iva != null ? Number(c.alicuota_iva) : 16);
    const montoIva = alicuota > 0 ? Math.round(baseImponible * (alicuota / 100) * 100) / 100 : 0;
    const total = Math.round((subtotal + montoIva) * 100) / 100;
    return {
      subtotal,
      exento,
      baseImponible,
      alicuota,
      montoIva,
      total: total > 0 ? total : montoCuenta,
      tieneIva: alicuota > 0 && montoIva > 0,
    };
  }

  const alicuota = c.alicuota_iva != null ? Number(c.alicuota_iva) : 0;
  if (alicuota > 0 && montoCuenta > 0) {
    const subtotal = Math.round((montoCuenta / (1 + (alicuota / 100))) * 100) / 100;
    const montoIva = Math.round((montoCuenta - subtotal) * 100) / 100;
    return {
      subtotal,
      exento: 0,
      baseImponible: subtotal,
      alicuota,
      montoIva,
      total: montoCuenta,
      tieneIva: true,
    };
  }

  return {
    subtotal: montoCuenta,
    exento: 0,
    baseImponible: montoCuenta,
    alicuota: 0,
    montoIva: 0,
    total: montoCuenta,
    tieneIva: false,
  };
}

/** `contraparte` NO viene de la base: se resuelve contra el maestro
 *  (`suppliers` / `companies`) al momento de pintar. */
type CuentaCalc = Cuenta & {
  contraparte: string;
  abonado: number;
  saldo: number;
  situacion: Situacion;
  empresaId: string;
  empresaNombre: string;
  condicionesPago: string;
  notaLimpia: string;
  aprobacionEstado: 'esperando_aprobacion' | 'esperando_pago' | 'pagada' | 'no_aplica';
  aprobacionInfo: AprobacionCxpInfo | null;
  esMayorAMil: boolean;
  traza: TrazabilidadPorPagar;
  infoPago: InfoMetodoPagoPorPagar;
  desgloseIva: DesgloseIvaCuenta;
  presupuestosCount: number;
};

/** Calcula saldo y situación de una cuenta a partir de sus abonos.
 *  Regla: una cuenta 'pendiente' cuyo saldo llegó a 0 con abonos ya se
 *  considera PAGADA aunque nadie haya tocado el botón — si no, seguiría
 *  sumando a "lo que debo" habiendo cobrado todo. */
function calcular(
  c: Cuenta,
  abonos: CuentaAbono[],
  hoy: string,
  contraparte: string,
  empresaInfo: InfoEmpresaCuenta,
  condYNota: { condicionesPago: string; notaLimpia: string },
  traza: TrazabilidadPorPagar,
  infoPago: InfoMetodoPagoPorPagar,
  desgloseIva: DesgloseIvaCuenta,
  aprobacionEstado: 'esperando_aprobacion' | 'esperando_pago' | 'pagada' | 'no_aplica' = 'no_aplica',
  aprobacionInfo: AprobacionCxpInfo | null = null
): CuentaCalc {
  const abonado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  // Si la cuenta viene de un requerimiento con IVA y el monto en la base era el neto sin IVA,
  // el monto total a pagar prevalece con el desglose exacto de IVA.
  const monto = desgloseIva.tieneIva && desgloseIva.total > (Number(c.monto) || 0)
    ? desgloseIva.total
    : (Number(c.monto) || 0);
  const saldo = Math.max(0, Math.round((monto - abonado) * 100) / 100);
  let situacion: Situacion;
  if (c.estado === 'anulada') situacion = 'anulada';
  else if (c.estado === 'pagada' || saldo <= 0) situacion = 'pagada';
  else if (c.fecha_vencimiento && c.fecha_vencimiento < hoy) situacion = 'vencida';
  else if (c.fecha_vencimiento && diasEntre(hoy, c.fecha_vencimiento) <= DIAS_POR_VENCER) situacion = 'por_vencer';
  else situacion = 'pendiente';
  const estadoAprobFinal =
    c.tipo !== 'por_pagar' || situacion === 'anulada'
      ? 'no_aplica'
      : situacion === 'pagada'
        ? 'pagada'
        : aprobacionEstado;

  const presCta = extraerFormatosAdjuntos(c);
  const presReq = traza.reqVinculado ? extraerFormatosAdjuntos(traza.reqVinculado) : [];
  const presupuestosCount = presCta.length + presReq.length;

  return {
    ...c,
    monto,
    contraparte,
    abonado,
    saldo,
    situacion,
    empresaId: empresaInfo.id,
    empresaNombre: empresaInfo.name,
    condicionesPago: condYNota.condicionesPago,
    notaLimpia: condYNota.notaLimpia,
    aprobacionEstado: estadoAprobFinal,
    aprobacionInfo,
    esMayorAMil: monto >= 1000,
    traza,
    infoPago,
    desgloseIva,
    presupuestosCount,
  };
}

/** Orden de la lista (y del reporte): lo más urgente arriba (vencida → por
 *  vencer → pendiente → pagada/anulada); dentro de cada situación la prioridad
 *  marcada manda (alta antes que media/baja/sin) y luego el vencimiento más
 *  cercano. */
function ordenUrgencia(a: CuentaCalc, b: CuentaCalc) {
  const rank: Record<Situacion, number> = { vencida: 0, por_vencer: 1, pendiente: 2, pagada: 3, anulada: 4 };
  if (rank[a.situacion] !== rank[b.situacion]) return rank[a.situacion] - rank[b.situacion];
  const pa = a.prioridad ? PRIORIDAD_RANK[a.prioridad as Prioridad] : 3;
  const pb = b.prioridad ? PRIORIDAD_RANK[b.prioridad as Prioridad] : 3;
  if (pa !== pb) return pa - pb;
  const av = a.fecha_vencimiento ?? '9999-12-31';
  const bv = b.fecha_vencimiento ?? '9999-12-31';
  if (av !== bv) return av < bv ? -1 : 1;
  return cmpText(a.contraparte, b.contraparte);
}

// ── Pestaña (el mismo componente para los dos tipos) ─────────────────────────
export function CuentasTab({ tipo, canWrite }: { tipo: CuentaTipo; canWrite: boolean }) {
  const { colors } = useTheme();
  // 💱 Tasa BCV de hoy: para mostrar al lado de cada monto en US$ su equivalente en Bs (28-oct-2026).
  const { rate: tasaBcv } = useBcvRate();
  const { session, role, fullName, appRole } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const cfg = TIPO_CFG[tipo];
  const hoy = hoyISO();
  const uid = session?.user?.id ?? null;

  const { data: todas, loading, refetch } = useTable<Cuenta>('cuentas', { orderBy: 'fecha_vencimiento' });
  const { data: abonos, refetch: refetchAbonos } = useTable<CuentaAbono>('cuenta_abonos', { orderBy: 'fecha', ascending: false });
  const { data: suppliers, refetch: refetchSuppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: orders } = useTable<PurchaseOrder>('purchase_orders', { orderBy: 'created_at', ascending: false });
  const { data: requirements, refetch: refetchRequirements } = useTable<InventoryRequirement>('inventory_requirements');
  const { data: machinery } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: vehicles } = useTable<Vehicle>('vehicles', { orderBy: 'plate' });

  // ⚙️ Configuración y permisos de Aprobación Gerencial en Por Pagar
  const [configAprobacion, setConfigAprobacion] = useState<ReglaAprobacionMonto>(obtenerConfigAprobacionMonto);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [cfgActivo, setCfgActivo] = useState(true);
  const [cfgExigirEnTodos, setCfgExigirEnTodos] = useState(true);
  const [cfgMonto, setCfgMonto] = useState('0');
  const [cfgEmpresaId, setCfgEmpresaId] = useState<string | null>(null);
  const [cfgEmpresaNombre, setCfgEmpresaNombre] = useState('Todas las empresas');
  const [cfgAprobadoresIds, setCfgAprobadoresIds] = useState<string[]>([]);
  const [cfgAprobadoresNombres, setCfgAprobadoresNombres] = useState<string[]>([]);
  const [cfgUserSearch, setCfgUserSearch] = useState('');
  const [usuariosSistema, setUsuariosSistema] = useState<Array<{
    id: string;
    full_name: string;
    username?: string | null;
    cedula?: string | null;
    role?: string | null;
    app_role_name?: string | null;
  }>>([]);

  useEffect(() => {
    if (tipo !== 'por_pagar') return;
    let cancel = false;
    (async () => {
      try {
        const [{ data: profs }, { data: ft }] = await Promise.all([
          supabase.from('profiles').select('id, full_name, username, cedula, role, app_role:app_role_id(name)'),
          supabase.from('feature_toggles').select('key, enabled, extra_user_ids').eq('key', 'compras_req_aprobacion').maybeSingle(),
        ]);
        if (cancel) return;
        const lista = ((profs ?? []) as any[])
          .filter((p) => String(p.full_name || p.username || '').trim())
          .map((p) => ({
            id: String(p.id),
            full_name: String(p.full_name || p.username || '').trim(),
            username: p.username ? String(p.username) : null,
            cedula: p.cedula ? String(p.cedula) : null,
            role: p.role ? String(p.role) : null,
            app_role_name: p.app_role?.name ? String(p.app_role.name) : null,
          }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'));
        setUsuariosSistema(lista);

        if (ft) {
          const ids = Array.isArray(ft.extra_user_ids) ? ft.extra_user_ids.map(String) : [];
          const nombresDesdeIds = ids
            .map((id) => lista.find((u) => u.id === id)?.full_name)
            .filter((n): n is string => Boolean(n));
          setConfigAprobacion((prev) => {
            const next: ReglaAprobacionMonto = {
              ...prev,
              activo: typeof ft.enabled === 'boolean' ? ft.enabled : prev.activo,
              aprobadoresIds: ids.length > 0 ? ids : prev.aprobadoresIds,
              aprobadoresNombres: nombresDesdeIds.length > 0 ? nombresDesdeIds : prev.aprobadoresNombres,
            };
            guardarConfigAprobacionMonto(next);
            return next;
          });
        }
      } catch {}
    })();
    return () => { cancel = true; };
  }, [tipo]);

  const miPerfil = useMemo(
    () => usuariosSistema.find((u) => u.id === uid) || null,
    [usuariosSistema, uid]
  );

  const puedeVerConfigAprobacion = useMemo(
    () =>
      esUsuarioAutorizadoConfigAprobacion({
        fullName: miPerfil?.full_name || fullName,
        username: miPerfil?.username,
        cedula: miPerfil?.cedula,
        email: session?.user?.email,
      }),
    [miPerfil, fullName, session?.user?.email]
  );

  const puedeAprobarPagos = useMemo(
    () =>
      puedeUsuarioAprobarRequerimiento({
        userId: uid,
        fullName: miPerfil?.full_name || fullName,
        username: miPerfil?.username,
        cedula: miPerfil?.cedula,
        email: session?.user?.email,
        role,
        appRoleName: appRole?.name || miPerfil?.app_role_name,
        config: configAprobacion,
      }),
    [uid, miPerfil, fullName, session?.user?.email, role, appRole?.name, configAprobacion]
  );

  // El aprobador designado (ej. Jesús Lozada / lozcheli15 · C.I. 18162307) o admin siempre puede operar y modificar peticiones en Por Pagar
  const puedeOperarCxp = canWrite || puedeAprobarPagos || role === 'admin';

  const aprobadoresLabel = useMemo(
    () =>
      configAprobacion.aprobadoresNombres && configAprobacion.aprobadoresNombres.length > 0
        ? configAprobacion.aprobadoresNombres.join(' / ')
        : 'Gerente General',
    [configAprobacion.aprobadoresNombres]
  );

  const abrirConfigAprobadorModal = () => {
    if (!puedeVerConfigAprobacion) {
      toast.error('Solo Anthony Mansilla y Angelica Solis están autorizados para abrir esta configuración.');
      return;
    }
    const cur = configAprobacion || obtenerConfigAprobacionMonto();
    setCfgActivo(cur.activo !== false);
    const esTodos = Boolean(cur.exigirEnTodos || Number(cur.montoLimiteUSD) === 0);
    setCfgExigirEnTodos(esTodos);
    setCfgMonto(String(cur.montoLimiteUSD ?? 0));
    setCfgEmpresaId(cur.empresaId || null);
    setCfgEmpresaNombre(cur.empresaNombre || 'Todas las empresas');
    setCfgAprobadoresIds(Array.isArray(cur.aprobadoresIds) ? cur.aprobadoresIds : []);
    setCfgAprobadoresNombres(cur.aprobadoresNombres?.length ? cur.aprobadoresNombres : ['Gerente General']);
    setCfgUserSearch('');
    setConfigModalOpen(true);
  };

  const toggleUsuarioAprobadorCxp = (u: { id: string; full_name: string }) => {
    setCfgAprobadoresIds((prevIds) => {
      const yaEsta = prevIds.includes(u.id);
      const nextIds = yaEsta ? prevIds.filter((id) => id !== u.id) : [...prevIds, u.id];
      setCfgAprobadoresNombres((prevNames) => {
        if (yaEsta) {
          return prevNames.filter((n) => norm(n) !== norm(u.full_name));
        }
        const existeNombre = prevNames.some((n) => norm(n) === norm(u.full_name));
        return existeNombre ? prevNames : [...prevNames, u.full_name];
      });
      return nextIds;
    });
  };

  const guardarConfigAprobadorModal = async () => {
    if (!puedeVerConfigAprobacion) {
      toast.error('Solo Anthony Mansilla y Angelica Solis pueden guardar esta configuración.');
      return;
    }
    const m = cfgExigirEnTodos ? 0 : parseNum(cfgMonto);
    if (!cfgExigirEnTodos && !(m >= 0)) {
      toast.error('Indica un monto límite válido en USD.');
      return;
    }
    const nombresFinales = cfgAprobadoresNombres.length > 0 ? cfgAprobadoresNombres : ['Gerente General'];
    const nuevaRegla: ReglaAprobacionMonto = {
      montoLimiteUSD: m,
      exigirEnTodos: cfgExigirEnTodos,
      empresaId: cfgEmpresaId,
      empresaNombre: cfgEmpresaNombre,
      aprobadoresIds: cfgAprobadoresIds,
      aprobadoresNombres: nombresFinales,
      activo: cfgActivo,
    };
    guardarConfigAprobacionMonto(nuevaRegla);
    setConfigAprobacion(nuevaRegla);
    try {
      await supabase.from('feature_toggles').upsert({
        key: 'compras_req_aprobacion',
        enabled: cfgActivo,
        extra_user_ids: cfgAprobadoresIds,
        updated_at: nowISO(),
        updated_by: uid,
      });
    } catch {}
    setConfigModalOpen(false);
    toast.success(
      cfgActivo
        ? `Aprobador configurado: ${nombresFinales.join(', ')} (${cfgExigirEnTodos ? 'Todas las cuentas' : `> $${m.toLocaleString()} USD`}).`
        : 'Regla de aprobador desactivada.'
    );
  };

  // Filtro de estado prioritario en Por Pagar
  const [filtroEstadoCxp, setFiltroEstadoCxp] = useState<'todos' | 'esperando_aprobacion' | 'mayor_mil' | 'esperando_pago' | 'vencida' | 'prioridad_alta' | 'pagada'>('todos');

  // 📅 Filtro por Fecha Específica o Rango de Fechas en Por Pagar
  const [modoFechaCxp, setModoFechaCxp] = useState<'todas' | 'dia' | 'rango'>('todas');
  const [campoFechaCxp, setCampoFechaCxp] = useState<'cualquiera' | 'envio' | 'solicitud'>('cualquiera');
  const [fechaDesdeCxp, setFechaDesdeCxp] = useState('');
  const [fechaHastaCxp, setFechaHastaCxp] = useState('');

  // Tarjetas desplegadas (plegable / desplegable individual y en lote)
  const [tarjetasAbiertasIds, setTarjetasAbiertasIds] = useState<Set<string>>(new Set());
  const toggleTarjetaCuenta = (id: string) => {
    setTarjetasAbiertasIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Renglones expandidos por cuenta en la tarjeta
  const [renglonesAbiertosIds, setRenglonesAbiertosIds] = useState<Set<string>>(new Set());
  const toggleRenglonesCuenta = (id: string) => {
    setRenglonesAbiertosIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ✏️ Edición bidireccional de ítems del Requerimiento desde Por Pagar (Jesús Lozada / Aprobador / Admin)
  type DraftItemCxp = {
    name: string;
    qty: string;
    unit: string;
    unitUsd: string;
    note: string;
    exento: boolean;
    item_id: string | null;
    supplier_id?: string | null;
    supplier_name?: string | null;
  };
  const [editItemsCuenta, setEditItemsCuenta] = useState<CuentaCalc | null>(null);
  const [editItemsDraft, setEditItemsDraft] = useState<DraftItemCxp[]>([]);
  const [editItemsIvaAlicuota, setEditItemsIvaAlicuota] = useState<number>(0);
  const [editItemsMotivo, setEditItemsMotivo] = useState('');
  const [guardandoItemsCxp, setGuardandoItemsCxp] = useState(false);

  const abrirEditorItemsCxp = (c: CuentaCalc) => {
    if (!puedeAprobarPagos && role !== 'admin' && !canWrite) {
      return toast.error(`Solo ${aprobadoresLabel} está autorizado para modificar los ítems en Por Pagar.`);
    }
    const reqVinc = c.traza.reqVinculado;
    const baseItems: RequirementLine[] =
      reqVinc && Array.isArray(reqVinc.items) && reqVinc.items.length > 0
        ? reqVinc.items
        : c.traza.items.length > 0
          ? c.traza.items
          : [
              {
                product_id: null,
                name: c.concepto || 'Ítem de compra',
                qty: 1,
                unit: 'und',
                est_price: Number(c.monto) || 0,
                currency: 'USD',
                note: null,
                exento: true,
              },
            ];
    setEditItemsCuenta(c);
    setEditItemsIvaAlicuota(Number(reqVinc?.iva_alicuota) || 0);
    setEditItemsDraft(
      baseItems.map((it) => ({
        name: String(it.name || ''),
        qty: String(Number(it.qty) || 1),
        unit: String(it.unit || 'und'),
        unitUsd: String(Number(it.est_price ?? it.price_usd) || 0),
        note: String(it.note || ''),
        exento: Boolean(it.exento),
        item_id: (it as any).item_id ?? it.product_id ?? null,
        supplier_id: it.supplier_id ?? null,
        supplier_name: it.supplier_name ?? null,
      }))
    );
    setEditItemsMotivo('');
  };

  const guardarModificacionItemsCxp = async () => {
    if (!editItemsCuenta) return;
    const validos: RequirementLine[] = editItemsDraft
      .map((l) => {
        const qVal = parseNum(l.qty);
        const pVal = parseNum(l.unitUsd);
        const unitUsd = pVal > 0 ? pVal : 0;
        return {
          product_id: l.item_id ?? null,
          name: l.name.trim(),
          qty: qVal,
          unit: l.unit.trim() || 'und',
          est_price: unitUsd,
          price_usd: unitUsd > 0 ? unitUsd : undefined,
          total_usd: unitUsd > 0 ? Math.round(qVal * unitUsd * 100) / 100 : undefined,
          modo_precio: 'unidad' as const,
          currency: 'USD' as const,
          note: l.note.trim() || null,
          exento: Boolean(l.exento),
          supplier_id: l.supplier_id ?? editItemsCuenta.supplier_id ?? null,
          supplier_name: l.supplier_name ?? editItemsCuenta.contraparte ?? null,
        };
      })
      .filter((l) => l.name && l.qty > 0);

    if (validos.length === 0) {
      return toast.error('La petición debe conservar al menos 1 ítem válido con cantidad mayor a 0. Si deseas cancelar todo el pedido, usa el botón ⛔ Anular.');
    }

    const reqVinc = editItemsCuenta.traza.reqVinculado;
    const itemsAntes: RequirementLine[] =
      reqVinc && Array.isArray(reqVinc.items) && reqVinc.items.length > 0
        ? reqVinc.items
        : editItemsCuenta.traza.items;

    const diff = calcularDiffItemsCompra(itemsAntes, validos);
    if (!diff.huboCambios && !editItemsMotivo.trim()) {
      setEditItemsCuenta(null);
      return toast.info('No se detectaron cambios en los ítems.');
    }

    // Calcular total considerando IVA si el requerimiento tenía alícuota de IVA
    const alicuota = Number(editItemsIvaAlicuota) || 0;
    const subtotalBruto = validos.reduce((acc, it) => acc + (Number(it.qty) || 0) * (Number(it.est_price) || 0), 0);
    const baseGravable = validos.reduce((acc, it) => acc + (it.exento ? 0 : (Number(it.qty) || 0) * (Number(it.est_price) || 0)), 0);
    const ivaMonto = alicuota > 0 ? Math.round(baseGravable * (alicuota / 100) * 100) / 100 : 0;
    const nuevoMontoTotal = Math.round((subtotalBruto + ivaMonto) * 100) / 100;

    const nuevoConcepto = validos
      .map((it) => `${it.name} (${it.qty} ${it.unit || 'und'})`)
      .join(', ');

    const autorNombre = miPerfil?.full_name || fullName || session?.user?.email || 'Jesús Lozada';
    const motivoStr = editItemsMotivo.trim() ? ` · Motivo: ${editItemsMotivo.trim()}` : '';
    const detalleHist = `${diff.resumenTexto}${motivoStr}`;

    setGuardandoItemsCxp(true);
    try {
      const eventoHist = {
        tipo: 'items_modificados' as const,
        fecha: nowISO(),
        usuarioNombre: autorNombre,
        usuarioId: uid,
        origen: 'por_pagar' as const,
        titulo: `Modificación de ítems en Por Pagar (${editItemsCuenta.traza.reqCode || editItemsCuenta.documento || 'CXP'})`,
        detalle: detalleHist,
        montoAntes: Number(editItemsCuenta.monto) || diff.montoAntes,
        montoDespues: nuevoMontoTotal,
        cambiosItems: diff.cambios,
      };

      // 1. Si hay requerimiento vinculado, actualizar primero inventory_requirements
      //    El trigger `trg_req_sync_compra` actualizará purchase_orders y cuentas.monto / concepto automáticamente.
      const reqId = editItemsCuenta.inventory_requirement_id || reqVinc?.id || null;
      if (reqId) {
        const { data: rRow } = await supabase
          .from('inventory_requirements')
          .select('id, observaciones')
          .eq('id', reqId)
          .maybeSingle();
        const obsBase = rRow?.observaciones ?? reqVinc?.observaciones ?? null;
        const obsConHist = anexarEventoHistorial(obsBase, eventoHist);
        const { error: errReq } = await supabase
          .from('inventory_requirements')
          .update({
            items: validos,
            title: nuevoConcepto,
            observaciones: obsConHist,
          })
          .eq('id', reqId);
        if (errReq) throw errReq;
      }

      // 2. Actualizar la nota de la cuenta con el evento en el historial
      //    (y si la cuenta NO tiene inventory_requirement_id directo, actualizar también concepto y monto)
      const notaConHist = anexarEventoHistorial(editItemsCuenta.nota, eventoHist);
      const patchCuenta: Record<string, any> = {
        nota: notaConHist,
        updated_at: nowISO(),
      };
      if (!editItemsCuenta.inventory_requirement_id) {
        patchCuenta.concepto = nuevoConcepto;
        patchCuenta.monto = nuevoMontoTotal;
      }
      const { error: errCta } = await supabase
        .from('cuentas')
        .update(patchCuenta)
        .eq('id', editItemsCuenta.id);
      if (errCta) throw errCta;

      // Si había orden de compra vinculada sin trigger directo, sincronizarla también
      if (editItemsCuenta.order_id && !editItemsCuenta.inventory_requirement_id) {
        try {
          await supabase
            .from('purchase_orders')
            .update({
              items: validos.map((it) => ({
                item_id: it.product_id,
                name: it.name,
                qty: it.qty,
                unit: it.unit,
                unit_price: Number(it.est_price) || 0,
              })),
              total: nuevoMontoTotal,
            })
            .eq('id', editItemsCuenta.order_id);
        } catch {}
      }

      setEditItemsCuenta(null);
      refetchRequirements();
      refetch();
      toast.success(`✅ Ítems actualizados por ${autorNombre}. Se sincronizó el Requerimiento y se guardó en el Histórico.`);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudieron guardar los cambios en los ítems.');
    } finally {
      setGuardandoItemsCxp(false);
    }
  };

  // Filtro por empresa (una o varias)
  const [empresaSel, setEmpresaSel] = useState<Set<string>>(new Set());
  const [empresasOpen, setEmpresasOpen] = useState(false);
  const [empresaQ, setEmpresaQ] = useState('');

  // Maestro de contrapartes: proveedores para pagar, empresas para cobrar.
  const maestro = useMemo(
    () => (cfg.maestro === 'suppliers'
      ? suppliers.map((s) => ({ id: s.id, name: s.name }))
      : generalCompanies(companies).map((c) => ({ id: c.id, name: c.name }))
    ).slice().sort((a, b) => cmpText(a.name, b.name)),
    [cfg.maestro, suppliers, companies],
  );
  /** id → nombre. En la base solo vive el id; el nombre se resuelve aquí, así
   *  que si lo corrigen en el maestro, todas las deudas se corrigen solas. */
  const nombreDe = useMemo(() => {
    const m = new Map<string, string>();
    maestro.forEach((x) => m.set(x.id, x.name));
    // Fallback al NOMBRE LIBRE (`contraparte`) cuando la cuenta no viene del
    // catálogo — p. ej. las por_cobrar de mangueras (empresa de lista propia,
    // company_id null). Así la lista muestra el nombre igual.
    return (c: Cuenta) => {
      const id = (c.tipo === 'por_pagar' ? c.supplier_id : c.company_id) ?? '';
      const nombre = m.get(id);
      if (nombre) return nombre;
      const libre = (c.contraparte ?? '').trim();
      return libre || '—';
    };
  }, [maestro]);

  const [q, setQ] = useState('');
  const [verPagadas, setVerPagadas] = useState(false);

  // 📄 Reporte (28-oct-2026): cuentas MARCADAS por id. La marca sobrevive a
  // filtrar y buscar; el reporte puede salir de ellas o de toda la lista.
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [reporteOpen, setReporteOpen] = useState(false);
  const alternarMarca = (id: string) => setMarcadas((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ── Formulario (alta y edición comparten el mismo modal) ──────────────────
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Cuenta | null>(null);
  const [contraparteId, setContraparteId] = useState<string | null>(null);
  const [concepto, setConcepto] = useState('');
  const [documento, setDocumento] = useState('');
  const [monto, setMonto] = useState('');
  const [emision, setEmision] = useState(hoy);
  const [vence, setVence] = useState('');
  const [condicionesPago, setCondicionesPago] = useState('');
  const [nota, setNota] = useState('');
  const [prioridad, setPrioridad] = useState<Prioridad | null>(null);   // grado de prioridad (opcional)
  const [orderId, setOrderId] = useState<string | null>(null);          // orden de compra atada (opcional)
  const [facturaUrl, setFacturaUrl] = useState<string | null>(null);    // archivo de la factura
  const [subiendoFactura, setSubiendoFactura] = useState(false);
  const [reciboPagoUrl, setReciboPagoUrl] = useState<string | null>(null); // soporte/recibo de pago
  const [subiendoReciboPago, setSubiendoReciboPago] = useState(false);
  // 📄 Presupuesto / Cotizaciones (uno o varios archivos, imagen o PDF)
  const [presupuestos, setPresupuestos] = useState<FormatoAdjunto[]>([]);
  const [subiendoPresupuesto, setSubiendoPresupuesto] = useState(false);
  // 💰 Alícuota y cálculo de IVA para cuentas directas
  const [alicuotaIvaForm, setAlicuotaIvaForm] = useState<string>('16');
  const [aplicaIvaForm, setAplicaIvaForm] = useState(true);
  const [montoBaseForm, setMontoBaseForm] = useState('');
  const [empresaFormId, setEmpresaFormId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 🔗 Cuenta que nace de un requerimiento (29-oct-2026): proveedor, empresa y
  // prioridad se sincronizan con él (y con su orden) desde la base; el monto sale de
  // sus renglones y, pagada, el proveedor queda como se pagó.
  const atadaReq = !!edit?.inventory_requirement_id;
  const reqAtado = atadaReq ? requirements.find((r) => r.id === edit?.inventory_requirement_id) ?? null : null;
  const proveedorBloqueado = atadaReq && edit?.estado === 'pagada';

  // Órdenes de compra ligables (con etiqueta legible). Solo las de esta contraparte
  // si se puede resolver; si no, todas. purchase_orders puede estar vacía.
  const ordenLabel = (o: PurchaseOrder) => {
    const quien = (o.supplier_id ? suppliers.find((s) => s.id === o.supplier_id)?.name : companies.find((c) => c.id === o.company_id)?.name) || '';
    return `${fmtFecha((o.created_at || '').slice(0, 10))}${quien ? ` · ${quien}` : ''} · ${usd(Number(o.total) || 0)}`;
  };

  // ── Abono (pago parcial) ──────────────────────────────────────────────────
  const [abonoDe, setAbonoDe] = useState<CuentaCalc | null>(null);
  const [abMonto, setAbMonto] = useState('');
  const [abFecha, setAbFecha] = useState(hoy);
  const [abMetodo, setAbMetodo] = useState('');
  const [abRef, setAbRef] = useState('');
  const [abComprobanteUrl, setAbComprobanteUrl] = useState<string | null>(null);
  const [subiendoAbComprobante, setSubiendoAbComprobante] = useState(false);

  // ── Subir Factura(s) directo desde la tarjeta de Por Pagar (1 o más fotos/PDFs) ──
  const [facturaDe, setFacturaDe] = useState<CuentaCalc | null>(null);
  const [facArchivos, setFacArchivos] = useState<ArchivoSoporte[]>([]);
  const [facNumero, setFacNumero] = useState('');
  const [facEmpresa, setFacEmpresa] = useState('');
  const [facFecha, setFacFecha] = useState(hoy);
  const [facNota, setFacNota] = useState('');
  const [facProvQ, setFacProvQ] = useState('');
  const [facProvOpen, setFacProvOpen] = useState(false);
  const [subiendoFacDirecta, setSubiendoFacDirecta] = useState(false);
  const [guardandoFacDirecta, setGuardandoFacDirecta] = useState(false);

  const abrirSubirFactura = (c: CuentaCalc) => {
    setFacturaDe(c);
    const facCta = extraerFacturaCuenta(c);
    const reqVinc = c.inventory_requirement_id ? requirements.find((r) => r.id === c.inventory_requirement_id) : null;
    const facReq = reqVinc ? extraerFactura(reqVinc) : null;
    const archivosIni: ArchivoSoporte[] =
      facCta?.archivos && facCta.archivos.length > 0
        ? facCta.archivos
        : facReq?.archivos && facReq.archivos.length > 0
          ? facReq.archivos
          : c.factura_url
            ? [{ url: c.factura_url, tipo: c.factura_url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image', nombre: facCta?.nombre || facReq?.nombre || 'Factura adjunta' }]
            : facReq?.url
              ? [{ url: facReq.url, tipo: facReq.tipo === 'pdf' ? 'pdf' : 'image', nombre: facReq.nombre || 'Factura adjunta' }]
              : [];
    setFacArchivos(archivosIni);
    setFacNumero(facCta?.numero || facReq?.numero || c.documento || '');
    setFacEmpresa(facCta?.empresa || facReq?.empresa || c.contraparte || '');
    setFacFecha(facCta?.fecha || facReq?.fecha || c.fecha_emision || hoy);
    setFacNota(facCta?.nota || facReq?.nota || '');
    setFacProvQ('');
    setFacProvOpen(false);
  };

  const subirArchivoFacturaDirecta = async (origen: 'camara' | 'archivo') => {
    if (!facturaDe) return;
    setSubiendoFacDirecta(true);
    try {
      if (origen === 'camara') {
        const r = await takePhotoAndUpload(facturaDe.id, 'facturas');
        if (r.ok && r.url) {
          setFacArchivos((prev) => [
            ...prev,
            { url: r.url!, tipo: 'image', nombre: `Foto Factura #${prev.length + 1}.jpg` },
          ]);
          toast.success('Foto de factura agregada.');
        } else if (r.error) {
          toast.error(r.error);
        }
      } else {
        const r = await pickAndUploadDocFiles('facturas', facturaDe.id);
        if (r.ok && r.files && r.files.length > 0) {
          const nuevos: ArchivoSoporte[] = r.files.map((f, i) => ({
            url: f.url,
            tipo: f.kind === 'pdf' ? 'pdf' : 'image',
            nombre: f.name || `Factura #${i + 1}`,
          }));
          setFacArchivos((prev) => [...prev, ...nuevos]);
          toast.success(`${nuevos.length} archivo(s) de factura adjuntado(s).`);
        } else if (r.error) {
          toast.error(r.error);
        }
      }
    } finally {
      setSubiendoFacDirecta(false);
    }
  };

  const guardarFacturaDirecta = async () => {
    if (!facturaDe) return;
    if (facArchivos.length === 0 && !facNumero.trim() && !facNota.trim()) {
      return toast.error('Adjunta al menos una foto/PDF de la factura o escribe el N° de factura / nota.');
    }
    setGuardandoFacDirecta(true);
    try {
      const autor = miPerfil?.full_name || fullName || session?.user?.email || 'Tesorería';
      const primerArch = facArchivos[0] || null;
      const dataFac: FacturaData = {
        numero: facNumero.trim() || facturaDe.documento || (primerArch ? 'ADJ-FACT' : 'S/N'),
        empresa: facEmpresa.trim() || facturaDe.contraparte || 'Proveedor',
        fecha: facFecha || hoy,
        url: primerArch?.url || null,
        tipo: primerArch?.tipo || 'image',
        nombre: primerArch?.nombre || null,
        archivos: facArchivos,
        nota: facNota.trim() || null,
        subidaPor: autor,
        subidaAt: nowISO(),
      };
      const evFac = {
        tipo: 'factura_adjuntada' as const,
        fecha: nowISO(),
        usuarioNombre: autor,
        usuarioId: uid,
        origen: 'por_pagar' as const,
        titulo: `Factura ${dataFac.numero} adjuntada en Por Pagar`,
        detalle: `Proveedor: ${dataFac.empresa} · ${facArchivos.length || 1} archivo(s)${dataFac.nota ? ` · ${dataFac.nota}` : ''}`,
      };
      const notaActualizada = anexarEventoHistorial(inyectarFacturaEnCuentaNota(facturaDe.nota, dataFac), evFac);
      const { error } = await supabase
        .from('cuentas')
        .update({
          documento: facNumero.trim() || facturaDe.documento || null,
          factura_url: primerArch?.url || null,
          nota: notaActualizada,
          updated_at: nowISO(),
        })
        .eq('id', facturaDe.id);
      if (error) throw error;

      // Sincronizar bidireccionalmente con el Requerimiento asociado si existe
      if (facturaDe.inventory_requirement_id) {
        try {
          const { data: reqRows } = await supabase
            .from('inventory_requirements')
            .select('id, observaciones, attachment_url')
            .eq('id', facturaDe.inventory_requirement_id)
            .limit(1);
          if (reqRows && reqRows[0]) {
            const obsFac = anexarEventoHistorial(inyectarFacturaEnObservaciones(reqRows[0].observaciones, dataFac), evFac);
            const patchReq: Record<string, any> = { observaciones: obsFac };
            if (primerArch?.url && !reqRows[0].attachment_url) {
              patchReq.attachment_url = primerArch.url;
              patchReq.attachment_type = primerArch.tipo || 'image';
              patchReq.attachment_name = primerArch.nombre || `Factura ${dataFac.numero}`;
            }
            await supabase
              .from('inventory_requirements')
              .update(patchReq)
              .eq('id', facturaDe.inventory_requirement_id);
            refetchRequirements();
          }
        } catch (eSync) {
          console.warn('Sync factura cxp a req error:', eSync);
        }
      }

      setFacturaDe(null);
      refetch();
      toast.success('Factura(s) guardada(s) y sincronizada(s) con el Requerimiento.');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar la factura.');
    } finally {
      setGuardandoFacDirecta(false);
    }
  };

  // ── Subir Comprobante(s) de Pago directo desde la tarjeta (1 o más fotos/PDFs) ──
  const [comprobanteDe, setComprobanteDe] = useState<CuentaCalc | null>(null);
  const [compArchivos, setCompArchivos] = useState<ArchivoSoporte[]>([]);
  const [compRef, setCompRef] = useState('');
  const [compMetodo, setCompMetodo] = useState('');
  const [compFecha, setCompFecha] = useState(hoy);
  const [compNota, setCompNota] = useState('');
  const [compMarcarPagada, setCompMarcarPagada] = useState(true);
  const [subiendoComp, setSubiendoComp] = useState(false);
  const [guardandoComp, setGuardandoComp] = useState(false);

  const abrirSubirComprobante = (c: CuentaCalc) => {
    setComprobanteDe(c);
    const rp = extraerReciboPagoCuenta(c);
    const reqVinc = c.inventory_requirement_id ? requirements.find((r) => r.id === c.inventory_requirement_id) : null;
    const recReq = reqVinc ? extraerReciboPago(reqVinc) : null;
    const archivosIni: ArchivoSoporte[] =
      rp?.archivos && rp.archivos.length > 0
        ? rp.archivos
        : recReq?.archivos && recReq.archivos.length > 0
          ? recReq.archivos
          : rp?.url
            ? [{ url: rp.url, tipo: rp.tipo === 'pdf' ? 'pdf' : 'image', nombre: rp.nombre || 'Comprobante de pago' }]
            : recReq?.url
              ? [{ url: recReq.url, tipo: recReq.tipo === 'pdf' ? 'pdf' : 'image', nombre: recReq.nombre || 'Comprobante de pago' }]
              : [];
    setCompArchivos(archivosIni);
    setCompRef(rp?.referencia || recReq?.referencia || '');
    setCompMetodo(rp?.metodo || recReq?.metodo || '');
    setCompFecha(rp?.fecha || recReq?.fecha || hoy);
    setCompNota(rp?.nota || recReq?.nota || '');
    setCompMarcarPagada(c.estado !== 'pagada');
  };

  const subirArchivoComprobanteDirecto = async (origen: 'camara' | 'archivo') => {
    if (!comprobanteDe) return;
    setSubiendoComp(true);
    try {
      if (origen === 'camara') {
        const r = await takePhotoAndUpload(comprobanteDe.id, 'recibos_pago');
        if (r.ok && r.url) {
          setCompArchivos((prev) => [
            ...prev,
            { url: r.url!, tipo: 'image', nombre: `Foto Comprobante #${prev.length + 1}.jpg` },
          ]);
          toast.success('Foto del comprobante cargada.');
        } else if (r.error) {
          toast.error(r.error);
        }
      } else {
        const r = await pickAndUploadDocFiles('recibos_pago', comprobanteDe.id);
        if (r.ok && r.files && r.files.length > 0) {
          const nuevos: ArchivoSoporte[] = r.files.map((f, i) => ({
            url: f.url,
            tipo: f.kind === 'pdf' ? 'pdf' : 'image',
            nombre: f.name || `Comprobante #${i + 1}`,
          }));
          setCompArchivos((prev) => [...prev, ...nuevos]);
          toast.success(`${nuevos.length} archivo(s) de comprobante adjuntado(s).`);
        } else if (r.error) {
          toast.error(r.error);
        }
      }
    } finally {
      setSubiendoComp(false);
    }
  };

  const guardarComprobanteDirecto = async () => {
    if (!comprobanteDe) return;
    if (compArchivos.length === 0 && !compRef.trim() && !compNota.trim()) {
      return toast.error('Adjunta al menos una foto/PDF del comprobante o escribe el número de referencia.');
    }
    setGuardandoComp(true);
    try {
      const autor = miPerfil?.full_name || fullName || session?.user?.email || 'Tesorería';
      const primerArch = compArchivos[0] || null;
      const evComp = {
        tipo: compMarcarPagada ? ('pagado_completo' as const) : ('pago_registrado' as const),
        fecha: nowISO(),
        usuarioNombre: autor,
        usuarioId: uid,
        origen: 'por_pagar' as const,
        titulo: compMarcarPagada
          ? `Cuenta marcada como PAGADA con comprobante (${compRef.trim() || 'S/Ref'})`
          : `Comprobante de pago adjuntado (${compRef.trim() || 'S/Ref'})`,
        detalle: `Método: ${compMetodo.trim() || 'Cuentas por Pagar'} · Monto: ${usd(Number(comprobanteDe.monto) || 0)}${compNota.trim() ? ` · ${compNota.trim()}` : ''}`,
      };
      const notaActualizada = anexarEventoHistorial(
        inyectarReciboPagoEnNota(comprobanteDe.nota, {
          url: primerArch?.url || null,
          tipo: primerArch?.tipo || 'image',
          nombre: primerArch?.nombre || 'Comprobante de pago',
          archivos: compArchivos,
          referencia: compRef.trim() || null,
          metodo: compMetodo.trim() || null,
          nota: compNota.trim() || null,
          subidoPor: autor,
          fecha: compFecha || hoy,
        }),
        evComp
      );
      const patchCuenta: Record<string, any> = {
        nota: notaActualizada,
        updated_at: nowISO(),
      };
      if (compMarcarPagada && comprobanteDe.estado !== 'pagada') {
        patchCuenta.estado = 'pagada';
        patchCuenta.settled_by = session?.user?.id ?? null;
        patchCuenta.settled_at = nowISO();
      }
      const { error } = await supabase.from('cuentas').update(patchCuenta).eq('id', comprobanteDe.id);
      if (error) throw error;

      // Sincronizar también con el Requerimiento asociado si existe
      if (comprobanteDe.inventory_requirement_id) {
        try {
          const { data: reqRows } = await supabase
            .from('inventory_requirements')
            .select('id, observaciones')
            .eq('id', comprobanteDe.inventory_requirement_id)
            .limit(1);
          if (reqRows && reqRows[0]) {
            const notaRecibo = anexarEventoHistorial(
              inyectarReciboPagoEnObservaciones(reqRows[0].observaciones, {
                url: primerArch?.url || '',
                tipo: primerArch?.tipo || 'image',
                nombre: primerArch?.nombre || 'Comprobante de Pago Cuentas por Pagar',
                archivos: compArchivos,
                fecha: compFecha || hoy,
                referencia: compRef.trim() || comprobanteDe.documento || 'CXP-PAGADA',
                monto: Number(comprobanteDe.monto) || null,
                metodo: compMetodo.trim() || 'Cuentas por Pagar',
                nota: compNota.trim() || null,
                subidoPor: autor,
                subidoAt: nowISO(),
              }),
              evComp
            );
            await supabase
              .from('inventory_requirements')
              .update({ observaciones: notaRecibo })
              .eq('id', comprobanteDe.inventory_requirement_id);
            refetchRequirements();
          }
        } catch (eSync) {
          console.warn('Sync comprobante cxp a req error:', eSync);
        }
      }

      setComprobanteDe(null);
      refetch();
      toast.success(
        compMarcarPagada
          ? 'Comprobante(s) de pago guardado(s) y cuenta marcada como PAGADA (reflejado en Requerimientos).'
          : 'Comprobante(s) de pago guardado(s) en la cuenta.'
      );
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar el comprobante de pago.');
    } finally {
      setGuardandoComp(false);
    }
  };

  // ── Autorización Gerencial de Pago directamente en Por Pagar ───────────────
  const autorizarPagoCuenta = async (c: CuentaCalc) => {
    if (!puedeAprobarPagos && role !== 'admin') {
      return toast.error(`Solo ${aprobadoresLabel} está autorizado para aprobar pagos.`);
    }
    const aprobadorNombre = miPerfil?.full_name || fullName || session?.user?.email || 'Gerente General';
    const infoAp: AprobacionCxpInfo = {
      estado: 'aprobado',
      aprobadoPor: aprobadorNombre,
      aprobadoPorId: uid,
      fecha: nowISO(),
    };
    const evAp = {
      tipo: 'aprobacion_gerencial' as const,
      fecha: nowISO(),
      usuarioNombre: aprobadorNombre,
      usuarioId: uid,
      origen: 'por_pagar' as const,
      titulo: `Pago autorizado por ${aprobadorNombre}`,
      detalle: `Monto: ${usd(Number(c.monto) || 0)} · Proveedor: ${c.contraparte}`,
    };
    const nuevaNota = anexarEventoHistorial(inyectarAprobacionCxpEnNota(c.nota, infoAp), evAp);
    const { error } = await supabase
      .from('cuentas')
      .update({ nota: nuevaNota, updated_at: nowISO() })
      .eq('id', c.id);
    if (error) return toast.error(error.message);

    if (c.inventory_requirement_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, observaciones')
          .eq('id', c.inventory_requirement_id)
          .limit(1);
        if (reqRows && reqRows[0]) {
          const obsAp = anexarEventoHistorial(inyectarAprobacionCxpEnNota(reqRows[0].observaciones, infoAp), evAp);
          await supabase
            .from('inventory_requirements')
            .update({ observaciones: obsAp })
            .eq('id', c.inventory_requirement_id);
          refetchRequirements();
        }
      } catch {}
    }

    refetch();
    toast.success(`✅ Pago autorizado por ${aprobadorNombre}. Cuenta ahora en ⏳ Esperando Pago.`);
  };

  const autorizarPagoLote = async (cuentasParaAprobar: CuentaCalc[]) => {
    if (!puedeAprobarPagos && role !== 'admin') {
      return toast.error(`Solo ${aprobadoresLabel} está autorizado para aprobar pagos en lote.`);
    }
    if (cuentasParaAprobar.length === 0) return;
    const ok = await confirm({
      title: 'Autorizar pagos en lote',
      message: `¿Autorizar ${cuentasParaAprobar.length} cuenta(s) marcada(s) para que pasen a ⏳ Esperando Pago?`,
      confirmText: `Autorizar (${cuentasParaAprobar.length})`,
    });
    if (!ok) return;
    const aprobadorNombre = miPerfil?.full_name || fullName || session?.user?.email || 'Gerente General';
    const infoAp: AprobacionCxpInfo = {
      estado: 'aprobado',
      aprobadoPor: aprobadorNombre,
      aprobadoPorId: uid,
      fecha: nowISO(),
    };
    for (const c of cuentasParaAprobar) {
      const evAp = {
        tipo: 'aprobacion_gerencial' as const,
        fecha: nowISO(),
        usuarioNombre: aprobadorNombre,
        usuarioId: uid,
        origen: 'por_pagar' as const,
        titulo: `Pago autorizado en lote por ${aprobadorNombre}`,
        detalle: `Monto: ${usd(Number(c.monto) || 0)} · Proveedor: ${c.contraparte}`,
      };
      const nuevaNota = anexarEventoHistorial(inyectarAprobacionCxpEnNota(c.nota, infoAp), evAp);
      await supabase.from('cuentas').update({ nota: nuevaNota, updated_at: nowISO() }).eq('id', c.id);
      if (c.inventory_requirement_id) {
        try {
          const { data: reqRows } = await supabase
            .from('inventory_requirements')
            .select('id, observaciones')
            .eq('id', c.inventory_requirement_id)
            .limit(1);
          if (reqRows && reqRows[0]) {
            const obsAp = anexarEventoHistorial(inyectarAprobacionCxpEnNota(reqRows[0].observaciones, infoAp), evAp);
            await supabase
              .from('inventory_requirements')
              .update({ observaciones: obsAp })
              .eq('id', c.inventory_requirement_id);
          }
        } catch {}
      }
    }
    setMarcadas(new Set());
    refetchRequirements();
    refetch();
    toast.success(`✅ ${cuentasParaAprobar.length} cuenta(s) autorizada(s) por ${aprobadorNombre}.`);
  };

  const abrirNueva = () => {
    setEdit(null); setContraparteId(null); setConcepto(''); setDocumento('');
    setMonto(''); setEmision(hoy); setVence(''); setCondicionesPago(''); setNota('');
    setPrioridad(null); setOrderId(null); setFacturaUrl(null); setReciboPagoUrl(null);
    setPresupuestos([]);
    setAlicuotaIvaForm('16');
    setAplicaIvaForm(true);
    setMontoBaseForm('');
    setEmpresaFormId(null);
    setOpen(true);
  };
  const abrirEdicion = (c: Cuenta) => {
    setEdit(c);
    setContraparteId((c.tipo === 'por_pagar' ? c.supplier_id : c.company_id) ?? null);
    setConcepto(c.concepto);
    setDocumento(c.documento ?? '');
    setMonto(String(Number(c.monto) || 0));
    setEmision(c.fecha_emision);
    setVence(c.fecha_vencimiento ?? '');
    const { condicionesPago: condIni, notaLimpia } = resolverCondicionesYNotaCuenta(c, { requirements, orders });
    setCondicionesPago(condIni);
    setNota(notaLimpia);
    setPrioridad((c.prioridad as Prioridad) ?? null);
    setOrderId(c.order_id ?? null);
    setFacturaUrl(c.factura_url ?? null);
    const rp = extraerReciboPagoCuenta(c);
    setReciboPagoUrl(rp?.url ?? null);
    // Presupuestos existentes de la cuenta
    setPresupuestos(extraerFormatosAdjuntos(c));
    const alicIni = c.alicuota_iva != null ? Number(c.alicuota_iva) : 16;
    setAlicuotaIvaForm(String(alicIni));
    setAplicaIvaForm(alicIni > 0);
    const mNum = Number(c.monto) || 0;
    if (alicIni > 0 && mNum > 0) {
      const baseCalc = Math.round((mNum / (1 + (alicIni / 100))) * 100) / 100;
      setMontoBaseForm(String(baseCalc));
    } else {
      setMontoBaseForm(String(mNum));
    }
    const empExtraida = (c as any).empresaId || extraerEmpresaDeNota(c.nota)?.id || c.company_id;
    setEmpresaFormId(empExtraida && empExtraida !== ID_SIN_EMPRESA ? empExtraida : null);
    setOpen(true);
  };

  // Sube uno o varios ARCHIVOS DE PRESUPUESTO / COTIZACIÓN (imágenes o PDFs)
  const subirArchivosPresupuesto = async () => {
    setSubiendoPresupuesto(true);
    try {
      const r = await pickAndUploadDocFiles('presupuestos', edit?.id ?? 'nuevas');
      if (r.ok && r.files && r.files.length > 0) {
        const nuevos: FormatoAdjunto[] = r.files.map((f, i) => ({
          id: `pres-${Date.now()}-${i}`,
          url: f.url,
          kind: f.kind,
          name: f.name || `Presupuesto #${presupuestos.length + i + 1}`,
          uploadedAt: nowISO(),
        }));
        setPresupuestos((prev) => [...prev, ...nuevos]);
        toast.success(`${nuevos.length} archivo(s) de presupuesto agregado(s).`);
      } else if (r.error) {
        toast.error(r.error);
      }
    } finally {
      setSubiendoPresupuesto(false);
    }
  };

  // Toma FOTO DIRECTA con la cámara del presupuesto físico o cotización
  const tomarFotoPresupuesto = async () => {
    setSubiendoPresupuesto(true);
    try {
      const r = await takeAndUploadDocPhoto('presupuestos', edit?.id ?? 'nuevas');
      if (r.ok && r.url) {
        const nuevo: FormatoAdjunto = {
          id: `pres-${Date.now()}`,
          url: r.url,
          kind: 'image',
          name: r.name || `Foto Presupuesto #${presupuestos.length + 1}`,
          uploadedAt: nowISO(),
        };
        setPresupuestos((prev) => [...prev, nuevo]);
        toast.success('Foto de presupuesto agregada.');
      } else if (r.error) {
        toast.error(r.error);
      }
    } finally {
      setSubiendoPresupuesto(false);
    }
  };

  const quitarPresupuesto = (idx: number) => {
    setPresupuestos((prev) => prev.filter((_, i) => i !== idx));
  };

  // Sube la FACTURA (imagen/PDF) al bucket y guarda su URL en el estado del formulario.
  const subirFactura = async () => {
    setSubiendoFactura(true);
    try {
      const r = await pickAndUploadDocFile('facturas', edit?.id ?? 'nuevas');
      if (r.ok && r.url) { setFacturaUrl(r.url); toast.success('Factura adjuntada.'); }
      else if (r.error) toast.error(r.error);
    } finally { setSubiendoFactura(false); }
  };

  // Sube el RECIBO DE PAGO (imagen/PDF) al bucket y guarda su URL en el estado del formulario.
  const subirReciboPago = async () => {
    setSubiendoReciboPago(true);
    try {
      const r = await pickAndUploadDocFile('recibos_pago', edit?.id ?? 'cuentas');
      if (r.ok && r.url) { setReciboPagoUrl(r.url); toast.success('Recibo de pago adjuntado.'); }
      else if (r.error) toast.error(r.error);
    } finally { setSubiendoReciboPago(false); }
  };

  const subirComprobanteAbono = async () => {
    setSubiendoAbComprobante(true);
    try {
      const r = await pickAndUploadDocFile('abonos_comprobantes', abonoDe?.id ?? 'abonos');
      if (r.ok && r.url) { setAbComprobanteUrl(r.url); toast.success('Comprobante de abono adjuntado.'); }
      else if (r.error) toast.error(r.error);
    } finally { setSubiendoAbComprobante(false); }
  };

  const guardar = async () => {
    // La contraparte es OBLIGATORIA y va por id: la base tiene un CHECK que
    // rechaza cualquier cuenta sin ella (o con las dos a la vez).
    if (!contraparteId) return toast.error(tipo === 'por_pagar' ? 'Elige el proveedor al que se le debe.' : 'Elige la empresa que debe.');
    if (!concepto.trim()) return toast.error('Escribe el concepto (por qué se debe).');
    const importe = parseNum(monto);
    if (!(importe > 0)) return toast.error('El monto debe ser mayor que cero.');
    if (!fechaValida(emision)) return toast.error('La fecha de emisión debe ser AAAA-MM-DD.');
    if (vence && !fechaValida(vence)) return toast.error('La fecha de vencimiento debe ser AAAA-MM-DD.');
    if (vence && vence < emision) return toast.error('El vencimiento no puede ser anterior a la emisión.');

    const notaLimpia = limpiarNotaCuentasVisual(nota);
    const rpPrev = edit ? extraerReciboPagoCuenta(edit) : null;
    const facPrev = edit ? extraerFacturaCuenta(edit) : null;
    const apPrev = edit ? extraerAprobacionCxp(edit.nota) : null;
    let notaFinal = inyectarReciboPagoEnNota(
      notaLimpia,
      reciboPagoUrl
        ? {
            url: reciboPagoUrl,
            tipo: rpPrev?.tipo || 'image',
            nombre: rpPrev?.nombre || 'Recibo de pago',
            archivos: rpPrev?.archivos,
            referencia: rpPrev?.referencia,
            metodo: rpPrev?.metodo,
            nota: rpPrev?.nota,
            subidoPor: rpPrev?.subidoPor || session?.user?.email || 'Administración',
            fecha: rpPrev?.fecha,
          }
        : null
    );
    if (facPrev) {
      notaFinal = inyectarFacturaEnCuentaNota(notaFinal, facPrev) || '';
    }
    if (apPrev) {
      notaFinal = inyectarAprobacionCxpEnNota(notaFinal, apPrev) || '';
    }
    if (empresaFormId) {
      const comp = companies.find((co) => co.id === empresaFormId);
      notaFinal = inyectarEmpresaEnNota(notaFinal, empresaFormId, comp?.name) || '';
    } else {
      notaFinal = inyectarEmpresaEnNota(notaFinal, null, null) || '';
    }
    notaFinal = inyectarCondicionesPagoEnNota(notaFinal, condicionesPago.trim()) || '';

    // Empaquetar presupuestos en observaciones/nota
    notaFinal = empaquetarFormatosEnObservaciones(notaFinal, presupuestos);

    if (edit?.nota) {
      notaFinal = preservarHistorialYEnvioEnTexto(edit.nota, notaFinal) || '';
    }

    const alicuotaGuardar = aplicaIvaForm ? (Number(alicuotaIvaForm) || 0) : 0;

    const fila: Record<string, any> = {
      tipo,
      supplier_id: tipo === 'por_pagar' ? contraparteId : null,
      company_id: tipo === 'por_cobrar' ? contraparteId : null,
      order_id: orderId,
      concepto: concepto.trim(),
      documento: documento.trim() || null,
      factura_url: facturaUrl,
      presupuesto_files: presupuestos.length > 0 ? presupuestos : null,
      alicuota_iva: alicuotaGuardar,
      prioridad,
      monto: importe,
      fecha_emision: emision,
      fecha_vencimiento: vence || null,
      nota: notaFinal,
    };
    // 🔗 Atada a un requerimiento: el monto y el vínculo los pone la base
    //    (req_sync_compra); no se reenvían para no chocar con trg_cxp_req_guardia.
    if (edit?.inventory_requirement_id) { delete (fila as any).monto; delete (fila as any).order_id; }

    setBusy(true);
    const { error } = edit
      ? await supabase.from('cuentas').update({ ...fila, updated_at: nowISO() }).eq('id', edit.id)
      : await supabase.from('cuentas').insert({ ...fila, estado: 'pendiente', created_by: session?.user?.id ?? null });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (edit?.inventory_requirement_id) {
      try {
        await supabase
          .from('inventory_requirements')
          .update({
            prioridad: prioridad ?? null,
            ...(tipo === 'por_pagar' && contraparteId ? { supplier_id: contraparteId } : {}),
          })
          .eq('id', edit.inventory_requirement_id);
        refetchRequirements();
      } catch {}
    }
    setOpen(false); setEdit(null);
    refetch();
    toast.success(edit ? 'Cuenta actualizada.' : 'Cuenta registrada.');
  };

  const marcarPagada = async (c: CuentaCalc) => {
    const ok = await confirm({
      title: 'Marcar como pagada',
      message: c.saldo > 0
        ? `Quedan ${usd(c.saldo)} de saldo en la cuenta de ${c.contraparte} (${c.concepto}). ¿Marcarla como PAGADA de todos modos?`
        : `¿Marcar como PAGADA la cuenta de ${c.contraparte} (${c.concepto}) por ${usd(Number(c.monto) || 0)}?`,
      confirmText: 'Marcar pagada',
    });
    if (!ok) return;
    const autorPago = miPerfil?.full_name || fullName || session?.user?.email || 'Tesorería';
    const evPag = {
      tipo: 'pagado_completo' as const,
      fecha: nowISO(),
      usuarioNombre: autorPago,
      usuarioId: uid,
      origen: 'por_pagar' as const,
      titulo: `Cuenta marcada como PAGADA por ${autorPago}`,
      detalle: `Monto: ${usd(Number(c.monto) || 0)} · Proveedor: ${c.contraparte}`,
    };
    const notaConPag = anexarEventoHistorial(c.nota, evPag);
    const { error } = await supabase.from('cuentas')
      .update({ estado: 'pagada', settled_by: session?.user?.id ?? null, settled_at: nowISO(), nota: notaConPag, updated_at: nowISO() })
      .eq('id', c.id);
    if (error) return toast.error(error.message);

    // Sincronización automática con el requerimiento de compras si nació de uno.
    // ⚠️ 29-oct-2026: el requerimiento se busca por inventory_requirement_id; order_id
    //    es el id de la ORDEN y con él la búsqueda fallaba sin avisar.
    if (c.inventory_requirement_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, observaciones')
          .eq('id', c.inventory_requirement_id)
          .limit(1);
        if (reqRows && reqRows[0]) {
          const recExist = extraerReciboPago(reqRows[0]);
          const rpCuenta = extraerReciboPagoCuenta(c);
          let obsTarget = reqRows[0].observaciones;
          if (!recExist || (!recExist.url && !recExist.referencia)) {
            obsTarget = inyectarReciboPagoEnObservaciones(
              obsTarget,
              {
                url: rpCuenta?.url || '',
                tipo: rpCuenta?.tipo || 'image',
                nombre: rpCuenta?.nombre || 'Comprobante de Pago Cuentas por Pagar',
                archivos: rpCuenta?.archivos,
                fecha: rpCuenta?.fecha || nowISO().slice(0, 10),
                referencia: rpCuenta?.referencia || c.documento || 'CXP-PAGADA',
                monto: Number(c.monto) || null,
                metodo: rpCuenta?.metodo || 'Cuentas por Pagar',
                nota: rpCuenta?.nota || null,
                subidoPor: autorPago,
                subidoAt: nowISO(),
              }
            );
          }
          obsTarget = anexarEventoHistorial(obsTarget, evPag);
          await supabase
            .from('inventory_requirements')
            .update({ observaciones: obsTarget })
            .eq('id', c.inventory_requirement_id);
          refetchRequirements();
        }
      } catch (eSync) {
        console.warn('Sync cxp a req error:', eSync);
      }
    }

    refetch();
    toast.success('Cuenta marcada como pagada (reflejado en Requerimientos).');
  };

  const anular = async (c: CuentaCalc) => {
    const ok = await confirm({
      title: 'Anular / Rechazar cuenta',
      message:
        `¿Anular la cuenta de ${c.contraparte} (${c.concepto})? Deja de sumar en los totales, pero NO se borra: queda en el historial como anulada.` +
        (c.inventory_requirement_id ? '\n\nTambién se marcará como RECHAZADO el Requerimiento de Compra vinculado.' : ''),
      confirmText: 'Anular',
      danger: true,
    });
    if (!ok) return;
    const autorAnul = miPerfil?.full_name || fullName || session?.user?.email || 'Gerencia';
    const evAnul = {
      tipo: 'rechazado_o_anulado' as const,
      fecha: nowISO(),
      usuarioNombre: autorAnul,
      usuarioId: uid,
      origen: 'por_pagar' as const,
      titulo: `Cuenta anulada / rechazada en Por Pagar por ${autorAnul}`,
      detalle: `Proveedor: ${c.contraparte} · Monto: ${usd(Number(c.monto) || 0)}`,
    };
    const notaAnul = anexarEventoHistorial(c.nota, evAnul);
    const { error } = await supabase.from('cuentas').update({ estado: 'anulada', nota: notaAnul, updated_at: nowISO() }).eq('id', c.id);
    if (error) return toast.error(error.message);
    if (c.inventory_requirement_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, observaciones')
          .eq('id', c.inventory_requirement_id)
          .limit(1);
        const obsRech = anexarEventoHistorial(reqRows?.[0]?.observaciones ?? null, evAnul);
        await supabase
          .from('inventory_requirements')
          .update({
            status: 'rechazado',
            decided_by: uid,
            decided_by_name: autorAnul,
            decided_at: nowISO(),
            observaciones: obsRech,
          })
          .eq('id', c.inventory_requirement_id);
        refetchRequirements();
      } catch {}
    }
    refetch();
    toast.success('Cuenta anulada.');
  };

  const reabrir = async (c: CuentaCalc) => {
    const tieneAbonos = c.abonado > 0;
    const ok = await confirm({
      title: 'Revertir pago / Volver a pendiente',
      message: `¿Devolver a PENDIENTE la cuenta de ${c.contraparte} (${c.concepto})?` +
        (tieneAbonos ? `\n\nSe eliminarán también los abonos registrados (${usd(c.abonado)}) para restaurar el saldo completo.` : '') +
        (c.inventory_requirement_id ? '\n\nTambién se revertirá el estado de pago en el Requerimiento de Compra asociado.' : ''),
      confirmText: 'Volver a pendiente',
    });
    if (!ok) return;
    if (tieneAbonos) {
      await supabase.from('cuenta_abonos').delete().eq('cuenta_id', c.id);
    }
    const autorReab = miPerfil?.full_name || fullName || session?.user?.email || 'Administración';
    const evReab = {
      tipo: 'reabierto_pendiente' as const,
      fecha: nowISO(),
      usuarioNombre: autorReab,
      usuarioId: uid,
      origen: 'por_pagar' as const,
      titulo: `Pago revertido / Cuenta reabierta a pendiente por ${autorReab}`,
      detalle: `Proveedor: ${c.contraparte} · Monto: ${usd(Number(c.monto) || 0)}`,
    };
    const notaSinRecibo = anexarEventoHistorial(inyectarReciboPagoEnNota(c.nota, null), evReab);
    const { error } = await supabase.from('cuentas')
      .update({ estado: 'pendiente', settled_by: null, settled_at: null, nota: notaSinRecibo, updated_at: nowISO() })
      .eq('id', c.id);
    if (error) return toast.error(error.message);

    // Sincronizar con el requerimiento si está ligado (quitar recibo de pago y devolver a aprobado si estaba en esperando_recepcion/pagado)
    if (c.inventory_requirement_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, status, observaciones')
          .eq('id', c.inventory_requirement_id)
          .limit(1);
        if (reqRows && reqRows[0]) {
          const rRow = reqRows[0] as any;
          const obsSinRecibo = anexarEventoHistorial(inyectarReciboPagoEnObservaciones(rRow.observaciones, null), evReab);
          const nextStatus = rRow.status === 'esperando_recepcion' || rRow.status === 'pagado' ? 'aprobado' : rRow.status;
          await supabase
            .from('inventory_requirements')
            .update({ observaciones: obsSinRecibo, status: nextStatus })
            .eq('id', c.inventory_requirement_id);
          refetchRequirements();
        }
      } catch (eSync) {
        console.warn('Sync reabrir cxp a req error:', eSync);
      }
    }

    refetchAbonos();
    refetch();
    toast.success('Pago revertido. La cuenta y el requerimiento volvieron a pendiente por pagar.');
  };

  const eliminarAbono = async (a: CuentaAbono, c: CuentaCalc) => {
    const ok = await confirm({
      title: 'Eliminar abono',
      message: `¿Eliminar este abono de ${usd(Number(a.monto) || 0)} del ${fmtFecha(a.fecha)}? El saldo pendiente aumentará por ese monto.`,
      confirmText: 'Eliminar abono',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('cuenta_abonos').delete().eq('id', a.id);
    if (error) return toast.error(error.message);
    if (c.estado === 'pagada') {
      await supabase.from('cuentas').update({ estado: 'pendiente', settled_by: null, settled_at: null, updated_at: nowISO() }).eq('id', c.id);
    }
    refetchAbonos();
    refetch();
    toast.success('Abono eliminado.');
  };

  // Genera el RECIBO (PDF) de la cuenta: por_cobrar → "Recibo de cobro", por_pagar →
  // "Recibo de pago". Es solo lectura (no cambia la cuenta), por eso está disponible
  // aunque el usuario no tenga permiso de escritura.
  const generarRecibo = async (c: CuentaCalc) => {
    try {
      const abs = abonos
        .filter((a) => a.cuenta_id === c.id)
        .map((a) => ({ fecha: fmtFecha(a.fecha), monto: Number(a.monto) || 0, metodo: a.metodo, referencia: a.referencia }));
      await exportPdf(
        reciboCuentaHtml({
          tipo,
          numero: c.documento || ('CTA-' + String(c.id).slice(0, 8).toUpperCase()),
          fecha: fmtFecha(hoy),
          contraparte: c.contraparte,
          concepto: c.concepto,
          documento: c.documento,
          moneda: (c.moneda as string) || 'USD',
          monto: Number(c.monto) || 0,
          abonado: c.abonado,
          saldo: c.saldo,
          situacionLabel: SIT_INFO[c.situacion].label,
          fechaEmision: c.fecha_emision ? fmtFecha(c.fecha_emision) : null,
          fechaVencimiento: c.fecha_vencimiento ? fmtFecha(c.fecha_vencimiento) : null,
          condicionesPago: c.condicionesPago || null,
          nota: c.notaLimpia || null,
          abonos: abs,
        }),
        `${tipo === 'por_cobrar' ? 'Recibo de cobro' : 'Recibo de pago'} ${c.contraparte} ${fmtFecha(hoy)}`,
      );
    } catch (e: any) {
      toast.error('No se pudo generar el recibo: ' + (e?.message ?? e));
    }
  };

  const abrirAbono = (c: CuentaCalc) => {
    setAbonoDe(c); setAbMonto(String(c.saldo || '')); setAbFecha(hoy); setAbMetodo(''); setAbRef('');
    setAbComprobanteUrl(null);
  };

  const guardarAbono = async () => {
    if (!abonoDe) return;
    const importe = parseNum(abMonto);
    if (!(importe > 0)) return toast.error('El abono debe ser mayor que cero.');
    if (importe > abonoDe.saldo) return toast.error(`El abono no puede pasar del saldo (${usd(abonoDe.saldo)}).`);
    if (!fechaValida(abFecha)) return toast.error('La fecha del abono debe ser AAAA-MM-DD.');
    setBusy(true);
    const notaAbonoFinal = inyectarComprobanteEnAbonoNota(
      null,
      abComprobanteUrl ? { url: abComprobanteUrl, tipo: 'image', nombre: 'Soporte abono' } : null
    );
    const { error } = await supabase.from('cuenta_abonos').insert({
      cuenta_id: abonoDe.id, monto: importe, fecha: abFecha,
      metodo: abMetodo.trim() || null, referencia: abRef.trim() || null,
      nota: notaAbonoFinal,
      created_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);

    const autorAbono = miPerfil?.full_name || fullName || session?.user?.email || 'Tesorería';
    const evAbono = {
      tipo: (importe >= abonoDe.saldo ? 'pagado_completo' : 'pago_registrado') as 'pagado_completo' | 'pago_registrado',
      fecha: nowISO(),
      usuarioNombre: autorAbono,
      usuarioId: uid,
      origen: 'por_pagar' as const,
      titulo: importe >= abonoDe.saldo
        ? `Abono que salda la cuenta (${usd(importe)})`
        : `Abono parcial registrado (${usd(importe)})`,
      detalle: `Método: ${abMetodo.trim() || 'Abono'} · Ref: ${abRef.trim() || 'S/Ref'} · Saldo restante: ${usd(Math.max(0, abonoDe.saldo - importe))}`,
    };
    try {
      const notaConAb = anexarEventoHistorial(abonoDe.nota, evAbono);
      await supabase.from('cuentas').update({ nota: notaConAb, updated_at: nowISO() }).eq('id', abonoDe.id);
    } catch {}

    // Sincronización automática con requerimiento si el abono saldó la deuda
    if (abonoDe.inventory_requirement_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, observaciones')
          .eq('id', abonoDe.inventory_requirement_id)
          .limit(1);
        if (reqRows && reqRows[0]) {
          let obsTarget = reqRows[0].observaciones;
          if (importe >= abonoDe.saldo) {
            obsTarget = inyectarReciboPagoEnObservaciones(
              obsTarget,
              {
                url: abComprobanteUrl || '',
                tipo: 'image',
                nombre: 'Comprobante de Pago Cuentas por Pagar',
                fecha: abFecha,
                referencia: abRef.trim() || 'Abono Total CXP',
                monto: importe,
                metodo: abMetodo.trim() || 'Abono Bancario',
                subidoPor: autorAbono,
                subidoAt: nowISO(),
              }
            );
          }
          obsTarget = anexarEventoHistorial(obsTarget, evAbono);
          await supabase
            .from('inventory_requirements')
            .update({ observaciones: obsTarget })
            .eq('id', abonoDe.inventory_requirement_id);
          refetchRequirements();
        }
      } catch (eSync) {
        console.warn('Sync cxp abono a req error:', eSync);
      }
    }

    setAbonoDe(null);
    refetchAbonos(); refetch();
    toast.success(importe >= abonoDe.saldo ? 'Abono registrado. La cuenta quedó saldada.' : 'Abono registrado.');
  };

  // ── Lista + totales con filtro por empresa (una o varias), fechas y estados de Por Pagar ──
  const { lista, tot, empresaCounts, ordenadas, universo, porEmpresasCounts } = useMemo(() => {
    const porCuenta = new Map<string, CuentaAbono[]>();
    abonos.forEach((a) => {
      const arr = porCuenta.get(a.cuenta_id) ?? [];
      arr.push(a);
      porCuenta.set(a.cuenta_id, arr);
    });

    const exigirTodos = Boolean(configAprobacion.exigirEnTodos || Number(configAprobacion.montoLimiteUSD) === 0);
    const limiteRegla = exigirTodos ? 0 : Number(configAprobacion.montoLimiteUSD) || 1000;

    const calc = todas
      .filter((c) => c.tipo === tipo)
      .map((c) => {
        const empInfo = resolverEmpresaDeCuenta(c, {
          companies,
          requirements,
          orders,
        });
        const condYNota = resolverCondicionesYNotaCuenta(c, {
          requirements,
          orders,
        });
        const traza = resolverTrazabilidadPorPagar(c, {
          requirements,
          orders,
          companies,
          machinery,
          vehicles,
        });
        let apEstado: 'esperando_aprobacion' | 'esperando_pago' | 'pagada' | 'no_aplica' = 'no_aplica';
        let apInfo: AprobacionCxpInfo | null = null;
        if (c.tipo === 'por_pagar') {
          const apCuenta = extraerAprobacionCxp(c.nota);
          const reqVinc = traza.reqVinculado || (c.inventory_requirement_id ? requirements.find((r) => r.id === c.inventory_requirement_id) : null);
          const apReq = reqVinc ? extraerAprobacionCxp(reqVinc.observaciones) : null;
          apInfo = apCuenta?.estado === 'aprobado' ? apCuenta : apReq?.estado === 'aprobado' ? apReq : apCuenta || apReq || null;
          const montoNum = Number(c.monto) || 0;
          if (apInfo?.estado === 'aprobado') {
            apEstado = 'esperando_pago';
          } else if (configAprobacion.activo === false) {
            apEstado = 'esperando_pago';
          } else if (!exigirTodos && montoNum <= limiteRegla && apInfo?.estado !== 'pendiente') {
            apEstado = 'esperando_pago';
          } else {
            apEstado = 'esperando_aprobacion';
          }
        }
        const abonosCta = porCuenta.get(c.id) ?? [];
        const abonadoCta = abonosCta.reduce((s, a) => s + (Number(a.monto) || 0), 0);
        const desgloseIva = resolverDesgloseIvaCuenta(c, traza.reqVinculado, tasaBcv);
        const montoBaseCalc = desgloseIva.tieneIva && desgloseIva.total > (Number(c.monto) || 0)
          ? desgloseIva.total
          : (Number(c.monto) || 0);
        const saldoCta = Math.max(0, Math.round((montoBaseCalc - abonadoCta) * 100) / 100);
        const nomContraparte = nombreDe(c);
        const infoPago = resolverInfoMetodoPagoPorPagar(c, {
          suppliers,
          requirements,
          orders,
          contraparteNombre: nomContraparte,
          condicionesPago: condYNota.condicionesPago,
          notaLimpia: condYNota.notaLimpia,
          tasaBcv,
          saldoUsd: saldoCta,
        });
        return calcular(c, abonosCta, hoy, nomContraparte, empInfo, condYNota, traza, infoPago, desgloseIva, apEstado, apInfo);
      });

    // Conteo y saldo por empresa (para las fichas / chips del filtro)
    const mEmp = new Map<string, { id: string; name: string; count: number; saldo: number }>();
    calc.forEach((c) => {
      if (c.situacion === 'pagada' || c.situacion === 'anulada') return;
      const exist = mEmp.get(c.empresaId) ?? { id: c.empresaId, name: c.empresaNombre, count: 0, saldo: 0 };
      exist.count += 1;
      exist.saldo += c.saldo;
      mEmp.set(c.empresaId, exist);
    });
    const arrEmpresas = Array.from(mEmp.values()).sort((a, b) => b.count - a.count || cmpText(a.name, b.name));

    // Filtrar por empresas seleccionadas si aplica
    const porEmpresas = calc.filter((c) => pasaFiltroEmpresas(c.empresaId, empresaSel));

    // Conteos para los chips de estado prioritario en Por Pagar
    const countsCxp = {
      abiertas: porEmpresas.filter((c) => c.situacion !== 'pagada' && c.situacion !== 'anulada').length,
      esperando_aprobacion: porEmpresas.filter((c) => c.aprobacionEstado === 'esperando_aprobacion').length,
      mayor_mil: porEmpresas.filter((c) => c.esMayorAMil && c.situacion !== 'pagada' && c.situacion !== 'anulada').length,
      esperando_pago: porEmpresas.filter((c) => c.aprobacionEstado === 'esperando_pago').length,
      vencida: porEmpresas.filter((c) => c.situacion === 'vencida').length,
      prioridad_alta: porEmpresas.filter((c) => c.prioridad === 'alta' && c.situacion !== 'pagada' && c.situacion !== 'anulada').length,
      pagada: porEmpresas.filter((c) => c.situacion === 'pagada').length,
    };

    // Los totales se calculan sobre las cuentas del filtro de empresa (la posición real de esa selección)
    const t = { pendiente: 0, vencido: 0, porVencer: 0, nVencidas: 0 };
    porEmpresas.forEach((c) => {
      if (c.situacion === 'anulada' || c.situacion === 'pagada') return;
      t.pendiente += c.saldo;
      if (c.situacion === 'vencida') { t.vencido += c.saldo; t.nVencidas += 1; }
      if (c.situacion === 'por_vencer') t.porVencer += c.saldo;
    });

    const nq = norm(q);
    const mostrarPagadasEfectivo = verPagadas || (tipo === 'por_pagar' && filtroEstadoCxp === 'pagada');
    const pasaVerPagadas = (c: CuentaCalc) => (mostrarPagadasEfectivo ? true : c.situacion !== 'pagada' && c.situacion !== 'anulada');
    const pasaFiltroEstadoCxp = (c: CuentaCalc) => {
      if (tipo !== 'por_pagar' || filtroEstadoCxp === 'todos') return true;
      if (filtroEstadoCxp === 'esperando_aprobacion') return c.aprobacionEstado === 'esperando_aprobacion';
      if (filtroEstadoCxp === 'mayor_mil') return c.esMayorAMil && c.situacion !== 'pagada' && c.situacion !== 'anulada';
      if (filtroEstadoCxp === 'esperando_pago') return c.aprobacionEstado === 'esperando_pago';
      if (filtroEstadoCxp === 'vencida') return c.situacion === 'vencida';
      if (filtroEstadoCxp === 'prioridad_alta') return c.prioridad === 'alta' && c.situacion !== 'pagada' && c.situacion !== 'anulada';
      if (filtroEstadoCxp === 'pagada') return c.situacion === 'pagada';
      return true;
    };
    const pasaFiltroFechaCxp = (c: CuentaCalc) => {
      if (modoFechaCxp === 'todas') return true;
      const dEnvio = c.traza.fechaEnvioSoloDia || '';
      const dSol = c.traza.fechaSolicitudSoloDia || c.fecha_emision || '';
      const cumpleFecha = (d: string) => {
        if (!d) return false;
        if (modoFechaCxp === 'dia') {
          if (!fechaDesdeCxp) return true;
          return d === fechaDesdeCxp;
        }
        if (fechaDesdeCxp && d < fechaDesdeCxp) return false;
        if (fechaHastaCxp && d > fechaHastaCxp) return false;
        return true;
      };
      if (campoFechaCxp === 'envio') return cumpleFecha(dEnvio);
      if (campoFechaCxp === 'solicitud') return cumpleFecha(dSol);
      return cumpleFecha(dEnvio) || cumpleFecha(dSol);
    };
    const vis = porEmpresas
      .filter(pasaVerPagadas)
      .filter(pasaFiltroEstadoCxp)
      .filter(pasaFiltroFechaCxp)
      .filter((c) =>
        matchNorm(
          nq,
          c.contraparte,
          c.concepto,
          c.documento,
          c.nota,
          c.condicionesPago,
          c.notaLimpia,
          c.empresaNombre,
          c.traza.solicitadoPor,
          c.traza.registradoPor,
          c.traza.enviadoPorPagarPor,
          c.traza.destinoTexto,
          c.traza.areaTexto,
          c.traza.reqCode,
          c.infoPago.resumenCopiable
        )
      )
      // Orden: lo más urgente arriba (ver `ordenUrgencia`).
      .sort(ordenUrgencia);

    // 📄 Para el reporte: TODAS las de la pestaña (las marcadas salen de aquí,
    // aunque el filtro de ahora las esconda) y el «universo» = la lista sin
    // filtro de empresa ni búsqueda (contra él se decide si el papel es FILTRADO).
    const ord = calc.slice().sort(ordenUrgencia);
    const uni = ord.filter(pasaVerPagadas);

    return { lista: vis, tot: t, empresaCounts: arrEmpresas, ordenadas: ord, universo: uni, porEmpresasCounts: countsCxp };
  }, [todas, abonos, tipo, q, verPagadas, hoy, nombreDe, suppliers, tasaBcv, companies, requirements, orders, machinery, vehicles, empresaSel, configAprobacion, filtroEstadoCxp, modoFechaCxp, campoFechaCxp, fechaDesdeCxp, fechaHastaCxp]);

  // Contador de marcas: solo las que existen en esta pestaña; y cuántas no se ven ahora.
  const nMarcadas = useMemo(() => ordenadas.filter((c) => marcadas.has(c.id)).length, [ordenadas, marcadas]);
  const nMarcadasFuera = useMemo(() => {
    const visibles = new Set(lista.map((c) => c.id));
    return ordenadas.filter((c) => marcadas.has(c.id) && !visibles.has(c.id)).length;
  }, [ordenadas, lista, marcadas]);

  // ── Portapapeles y Modal Rápido de Métodos y Datos de Pago en Por Pagar ────
  const copiarTextoPortapapeles = async (texto: string, msgExito = '📋 Datos de pago copiados al portapapeles.') => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        toast.success(msgExito);
        return;
      }
      if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = texto;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast.success(msgExito);
        return;
      }
      toast.success(msgExito);
    } catch {
      toast.error('No se pudo copiar automáticamente.');
    }
  };

  const [pagoModalCuenta, setPagoModalCuenta] = useState<CuentaCalc | null>(null);
  const [pmCondiciones, setPmCondiciones] = useState('');
  const [pmNotaCuenta, setPmNotaCuenta] = useState('');
  const [pmVence, setPmVence] = useState('');
  // Campos financieros del proveedor en el modal rápido
  const [pmSupId, setPmSupId] = useState<string | null>(null);
  const [pmSupNombre, setPmSupNombre] = useState('');
  const [pmSupRif, setPmSupRif] = useState('');
  const [pmSupPhone, setPmSupPhone] = useState('');
  const [pmBankName, setPmBankName] = useState('');
  const [pmAccountNumber, setPmAccountNumber] = useState('');
  const [pmAccountType, setPmAccountType] = useState('Corriente');
  const [pmAccountHolder, setPmAccountHolder] = useState('');
  const [pmAccountIdDoc, setPmAccountIdDoc] = useState('');
  const [pmPagoMovilBank, setPmPagoMovilBank] = useState('');
  const [pmPagoMovilPhone, setPmPagoMovilPhone] = useState('');
  const [pmPagoMovilId, setPmPagoMovilId] = useState('');
  const [pmBinanceId, setPmBinanceId] = useState('');
  const [pmPaymentNotes, setPmPaymentNotes] = useState('');
  const [pmCapturaUrl, setPmCapturaUrl] = useState<string | null>(null);
  const [pmCapturaName, setPmCapturaName] = useState<string | null>(null);
  const [pmSubiendoCaptura, setPmSubiendoCaptura] = useState(false);
  const [pmGuardando, setPmGuardando] = useState(false);

  const abrirEditorPagoCxp = (c: CuentaCalc) => {
    const db = c.infoPago.datosBancarios;
    const supObj = db.proveedorId ? suppliers.find((s) => s.id === db.proveedorId) : null;
    const cap = extraerCapturaPago(supObj);
    setPagoModalCuenta(c);
    setPmCondiciones(c.condicionesPago || '');
    setPmNotaCuenta(c.notaLimpia || '');
    setPmVence(c.fecha_vencimiento || '');
    setPmSupId(db.proveedorId || c.supplier_id || null);
    setPmSupNombre(supObj?.name || db.proveedorNombre || c.contraparte || '');
    setPmSupRif(supObj?.rif || db.proveedorRif || '');
    setPmSupPhone(supObj?.phone || db.proveedorTelefono || '');
    setPmBankName(supObj?.bank_name || db.banco || '');
    setPmAccountNumber(supObj?.account_number || db.numeroCuenta || '');
    setPmAccountType(supObj?.account_type || db.tipoCuenta || 'Corriente');
    setPmAccountHolder(supObj?.account_holder || db.titular || '');
    setPmAccountIdDoc(supObj?.account_id_doc || db.rifTitular || '');
    setPmPagoMovilBank(supObj?.pago_movil_bank || db.pagoMovilBanco || '');
    setPmPagoMovilPhone(supObj?.pago_movil_phone || db.pagoMovilTelefono || '');
    setPmPagoMovilId(supObj?.pago_movil_id || db.pagoMovilCedulaRif || '');
    setPmBinanceId(supObj?.binance_id || db.binanceId || '');
    setPmPaymentNotes(limpiarNotasUsuario(supObj?.payment_notes) || db.instruccionesPago || '');
    setPmCapturaUrl(cap?.url || db.capturaPago?.url || null);
    setPmCapturaName(cap?.name || db.capturaPago?.name || null);
  };

  const subirCapturaPagoProvCxp = async (modo: 'camara' | 'archivo') => {
    setPmSubiendoCaptura(true);
    try {
      if (modo === 'camara') {
        const res = await takePhotoAndUpload('proveedores-pago', `prov-${Date.now()}`);
        if (res.ok && res.url) {
          setPmCapturaUrl(res.url);
          setPmCapturaName('Foto de datos de pago');
          toast.success('Foto de datos de pago adjuntada.');
        } else if (res.error) {
          toast.error(res.error);
        }
      } else {
        const res = await pickAndUploadDocFile('proveedores-pago', `prov-${Date.now()}`);
        if (res?.url) {
          setPmCapturaUrl(res.url);
          setPmCapturaName(res.name || 'Captura de pago');
          toast.success('Captura de pago adjuntada.');
        }
      }
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo subir la captura.');
    } finally {
      setPmSubiendoCaptura(false);
    }
  };

  const guardarEditorPagoCxp = async () => {
    if (!pagoModalCuenta) return;
    if (pmVence.trim() && !fechaValida(pmVence.trim())) {
      return toast.error('La fecha de vencimiento debe tener formato AAAA-MM-DD.');
    }
    setPmGuardando(true);
    try {
      let supplierIdFinal = pmSupId;
      const finalPaymentNotes = empaquetarNotasConCaptura(pmPaymentNotes, pmCapturaUrl, pmCapturaName);
      const payloadSupplier = {
        rif: pmSupRif.trim() || null,
        phone: pmSupPhone.trim() || null,
        bank_name: pmBankName.trim() || null,
        account_number: pmAccountNumber.trim() || null,
        account_type: pmAccountType.trim() || null,
        account_holder: pmAccountHolder.trim() || null,
        account_id_doc: pmAccountIdDoc.trim() || null,
        pago_movil_bank: pmPagoMovilBank.trim() || null,
        pago_movil_phone: pmPagoMovilPhone.trim() || null,
        pago_movil_id: pmPagoMovilId.trim() || null,
        binance_id: pmBinanceId.trim() || null,
        payment_notes: finalPaymentNotes,
      };

      const tieneAlgunDatoSup = Boolean(
        payloadSupplier.rif ||
          payloadSupplier.phone ||
          payloadSupplier.bank_name ||
          payloadSupplier.account_number ||
          payloadSupplier.pago_movil_phone ||
          payloadSupplier.pago_movil_bank ||
          payloadSupplier.binance_id ||
          payloadSupplier.payment_notes,
      );

      if (supplierIdFinal) {
        const { error: errSup } = await supabase
          .from('suppliers')
          .update(payloadSupplier)
          .eq('id', supplierIdFinal);
        if (errSup) {
          toast.error('Error al actualizar ficha del proveedor: ' + errSup.message);
          setPmGuardando(false);
          return;
        }
      } else if (tieneAlgunDatoSup && pmSupNombre.trim() && pmSupNombre.trim().toUpperCase() !== 'SIN CONTRAPARTE') {
        const { data: nuevoSup, error: errInsSup } = await supabase
          .from('suppliers')
          .insert({
            name: pmSupNombre.trim().toUpperCase(),
            ...payloadSupplier,
          })
          .select('id')
          .single();
        if (!errInsSup && nuevoSup?.id) {
          supplierIdFinal = nuevoSup.id;
        }
      }

      // Conservar todos los tags internos de `pagoModalCuenta.nota` y actualizar texto libre + [CONDICIONES_PAGO]
      const reciboExist = extraerReciboPagoCuenta(pagoModalCuenta);
      const facturaExist = extraerFacturaCuenta(pagoModalCuenta);
      const empExist = extraerEmpresaDeNota(pagoModalCuenta.nota);
      const empIdExist = empExist?.id || null;
      const empNameExist = empExist?.name || (empIdExist ? companies.find((co) => co.id === empIdExist)?.name : null);
      const aprobExist = extraerAprobacionCxp(pagoModalCuenta.nota);

      let notaCompuesta: string | null = pmNotaCuenta.trim() || null;
      notaCompuesta = inyectarEmpresaEnNota(notaCompuesta, empIdExist, empNameExist);
      notaCompuesta = inyectarCondicionesPagoEnNota(notaCompuesta, pmCondiciones.trim() || null);
      notaCompuesta = inyectarFacturaEnCuentaNota(notaCompuesta, facturaExist);
      notaCompuesta = inyectarReciboPagoEnNota(notaCompuesta, reciboExist);
      notaCompuesta = inyectarAprobacionCxpEnNota(notaCompuesta, aprobExist);
      notaCompuesta = preservarHistorialYEnvioEnTexto(pagoModalCuenta.nota, notaCompuesta);

      const autorCambio = miPerfil?.full_name || fullName || session?.user?.email || 'Administración';
      notaCompuesta = anexarEventoHistorial(notaCompuesta, {
        tipo: 'condicion_actualizada',
        fecha: nowISO(),
        usuarioNombre: autorCambio,
        usuarioId: uid,
        origen: 'por_pagar',
        titulo: 'Métodos, condiciones y datos de pago actualizados en Por Pagar',
        detalle: [
          pmCondiciones.trim() ? `Condiciones/Método: ${pmCondiciones.trim()}` : null,
          pmBankName.trim() || pmAccountNumber.trim() ? `Banco: ${pmBankName.trim()} ${pmAccountNumber.trim()}` : null,
          pmPagoMovilPhone.trim() ? `Pago Móvil: ${pmPagoMovilBank.trim()} ${pmPagoMovilPhone.trim()}` : null,
          pmBinanceId.trim() ? `Binance/Zelle: ${pmBinanceId.trim()}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Actualización de instrucciones de pago',
      });

      const updateCuentaPayload: Record<string, any> = {
        nota: notaCompuesta,
        fecha_vencimiento: pmVence.trim() || null,
        updated_at: nowISO(),
      };
      if (supplierIdFinal && supplierIdFinal !== pagoModalCuenta.supplier_id) {
        updateCuentaPayload.supplier_id = supplierIdFinal;
      }

      const { error: errCta } = await supabase
        .from('cuentas')
        .update(updateCuentaPayload)
        .eq('id', pagoModalCuenta.id);

      if (errCta) {
        toast.error(errCta.message);
        setPmGuardando(false);
        return;
      }

      // Si está vinculada a un requerimiento, sincronizar las condiciones de pago en observaciones
      const reqIdVinc = pagoModalCuenta.inventory_requirement_id || pagoModalCuenta.traza.reqVinculado?.id;
      if (reqIdVinc) {
        try {
          const { data: reqRows } = await supabase
            .from('inventory_requirements')
            .select('id, observaciones')
            .eq('id', reqIdVinc)
            .limit(1);
          if (reqRows && reqRows[0]) {
            const obsNueva = inyectarCondicionesPagoEnNota(reqRows[0].observaciones, pmCondiciones.trim() || null);
            await supabase
              .from('inventory_requirements')
              .update({ observaciones: obsNueva })
              .eq('id', reqIdVinc);
            refetchRequirements();
          }
        } catch {}
      }

      await Promise.all([refetch(), refetchSuppliers()]);
      setPagoModalCuenta(null);
      toast.success('💳 Métodos y datos de pago guardados correctamente.');
    } finally {
      setPmGuardando(false);
    }
  };

  const inputStyle = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const Quick = ({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) => (
    <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] as any }}>{usd(value)}</Text>
      {sub ? <Text style={{ color: colors.muted, fontSize: 10, marginTop: 1 }}>{sub}</Text> : null}
    </View>
  );

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
        <SectionTitle>Cuentas {cfg.label.toLowerCase()}</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', flexWrap: 'wrap' }}>
          {tipo === 'por_pagar' && puedeVerConfigAprobacion ? (
            <TouchableOpacity
              onPress={abrirConfigAprobadorModal}
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.brand,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.pill,
              }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                ⚙️ Aprobador: {aprobadoresLabel}
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* 📄 Reporte: solo lectura, así que también lo tiene quien no escribe. */}
          <TouchableOpacity onPress={() => setReporteOpen(true)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>📄 Reporte</Text>
          </TouchableOpacity>
          {canWrite ? (
            <TouchableOpacity onPress={abrirNueva} style={{ backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
              <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>+ Nueva</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Totales — ajustados a las empresas seleccionadas */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Quick label="TOTAL PENDIENTE" value={tot.pendiente} color={colors.brandText} />
        <Quick label="VENCIDO" value={tot.vencido} color={colors.dangerSoftText} sub={tot.nVencidas ? `${tot.nVencidas} cuenta(s)` : undefined} />
        <Quick label={`POR VENCER (${DIAS_POR_VENCER} DÍAS)`} value={tot.porVencer} color={colors.warningSoftText} />
      </View>

      {/* 🏢 Filtro por Empresa (una o varias) */}
      <View style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs, paddingVertical: 4 }}>
          <TouchableOpacity
            onPress={() => setEmpresasOpen((o) => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}
          >
            <Text style={{ fontSize: 14 }}>🏢</Text>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
              {empresaSel.size === 0
                ? 'EMPRESA: TODAS'
                : `EMPRESAS (${empresaSel.size} seleccionada${empresaSel.size > 1 ? 's' : ''})`}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {empresasOpen ? '▲ Ocultar lista' : '▼ Filtrar por una o varias'}
            </Text>
          </TouchableOpacity>

          {empresaSel.size > 0 ? (
            <TouchableOpacity
              onPress={() => setEmpresaSel(new Set())}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11 }}>✕ Quitar filtros</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Fichas rápidas horizontales siempre accesibles */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4, paddingHorizontal: 2 }}>
          <TouchableOpacity
            onPress={() => setEmpresaSel(new Set())}
            style={{
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: empresaSel.size === 0 ? colors.brand : colors.border,
              backgroundColor: empresaSel.size === 0 ? colors.brand : colors.surface,
              paddingHorizontal: spacing.sm,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: empresaSel.size === 0 ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>
              Todas ({empresaCounts.reduce((s, e) => s + e.count, 0)})
            </Text>
          </TouchableOpacity>

          {empresaCounts.map((e) => {
            const on = empresaSel.has(e.id);
            return (
              <TouchableOpacity
                key={e.id}
                onPress={() => {
                  setEmpresaSel((prev) => {
                    const next = new Set(prev);
                    if (next.has(e.id)) next.delete(e.id);
                    else next.add(e.id);
                    return next;
                  });
                }}
                style={{
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? colors.brand : colors.border,
                  backgroundColor: on ? colors.brand : colors.surface,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>
                  {on ? '✓ ' : ''}{e.name}
                </Text>
                <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 10, fontWeight: '600' }}>
                  · {e.count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Panel desplegable con buscador de empresas */}
        {empresasOpen ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
            <TextInput
              value={empresaQ}
              onChangeText={setEmpresaQ}
              placeholder="Buscar empresa por nombre…"
              placeholderTextColor={colors.muted}
              style={[inputStyle, { marginBottom: spacing.xs, paddingVertical: 4, fontSize: 12 }]}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxHeight: 180 }}>
              {empresaCounts
                .filter((e) => !empresaQ || matchNorm(norm(empresaQ), e.name))
                .map((e) => {
                  const on = empresaSel.has(e.id);
                  return (
                    <TouchableOpacity
                      key={e.id}
                      onPress={() => {
                        setEmpresaSel((prev) => {
                          const next = new Set(prev);
                          if (next.has(e.id)) next.delete(e.id);
                          else next.add(e.id);
                          return next;
                        });
                      }}
                      style={{
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: on ? colors.brand : colors.border,
                        backgroundColor: on ? colors.brand : colors.surface,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 4,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>
                        {on ? '☑ ' : '☐ '}{e.name}
                      </Text>
                      <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 10 }}>
                        ({e.count} · {usd(e.saldo)})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
            </View>
          </View>
        ) : null}
      </View>

      {/* Filtros de estados prioritarios de Por Pagar (Esperando Aprobación, > $1,000 USD, Esperando Pago, Vencidas, Prioridad Alta, Pagadas) */}
      {tipo === 'por_pagar' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingVertical: 4, marginBottom: spacing.xs }}
        >
          {(
            [
              ['todos', `Todas (${porEmpresasCounts.abiertas})`, colors.brand, colors.brandContrast],
              [
                'esperando_aprobacion',
                `👔 Esperando Aprobación: ${aprobadoresLabel} (${porEmpresasCounts.esperando_aprobacion})`,
                colors.warningSoftBorder,
                colors.warningSoftText,
              ],
              [
                'mayor_mil',
                `💰 Pago > $1,000 USD (${porEmpresasCounts.mayor_mil})`,
                colors.dangerSoftBorder,
                colors.dangerSoftText,
              ],
              [
                'esperando_pago',
                `⏳ Esperando Pago (${porEmpresasCounts.esperando_pago})`,
                colors.infoSoftBorder,
                colors.infoSoftText,
              ],
              [
                'vencida',
                `🔴 Vencidas (${porEmpresasCounts.vencida})`,
                colors.danger,
                colors.dangerSoftText,
              ],
              [
                'prioridad_alta',
                `🔺 Prioridad Alta (${porEmpresasCounts.prioridad_alta})`,
                colors.dangerSoftBorder,
                colors.dangerSoftText,
              ],
              [
                'pagada',
                `✅ Pagadas (${porEmpresasCounts.pagada})`,
                colors.successSoftBorder,
                colors.successSoftText,
              ],
            ] as const
          ).map(([key, label, activeBorder, activeText]) => {
            const on = filtroEstadoCxp === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => {
                  setFiltroEstadoCxp(key);
                  if (key === 'pagada') setVerPagadas(true);
                }}
                style={{
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? activeBorder : colors.border,
                  backgroundColor: on
                    ? key === 'todos'
                      ? colors.brand
                      : colors.surfaceAlt
                    : colors.surface,
                  paddingHorizontal: spacing.md,
                  paddingVertical: 6,
                }}
              >
                <Text
                  style={{
                    color: on ? (key === 'todos' ? colors.brandContrast : activeText) : colors.text,
                    fontWeight: '800',
                    fontSize: 12,
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {/* 📅 Filtro por Fecha Específica o Rango de Fechas (Solicitud / Marcado para Por Pagar) */}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            📅 Filtrar por Fecha:
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(
              [
                ['todas', 'Todas las fechas'],
                ['dia', '📆 Fecha específica'],
                ['rango', '🗓️ Rango (Desde — Hasta)'],
              ] as const
            ).map(([k, lbl]) => {
              const on = modoFechaCxp === k;
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => {
                    setModoFechaCxp(k);
                    if (k === 'todas') {
                      setFechaDesdeCxp('');
                      setFechaHastaCxp('');
                    } else if (k === 'dia' && !fechaDesdeCxp) {
                      setFechaDesdeCxp(hoy);
                    }
                  }}
                  style={{
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: on ? colors.brand : colors.border,
                    backgroundColor: on ? colors.brand : colors.surface,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11 }}>
                    {lbl}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => {
                setModoFechaCxp('dia');
                setFechaDesdeCxp(hoy);
                setFechaHastaCxp(hoy);
              }}
              style={{
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: modoFechaCxp === 'dia' && fechaDesdeCxp === hoy ? colors.brand : colors.border,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>Hoy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const ayer = masDias(hoy, -1);
                setModoFechaCxp('dia');
                setFechaDesdeCxp(ayer);
                setFechaHastaCxp(ayer);
              }}
              style={{
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>Ayer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setModoFechaCxp('rango');
                setFechaDesdeCxp(masDias(hoy, -7));
                setFechaHastaCxp(hoy);
              }}
              style={{
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>Últimos 7 días</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setModoFechaCxp('rango');
                setFechaDesdeCxp(`${hoy.slice(0, 8)}01`);
                setFechaHastaCxp(hoy);
              }}
              style={{
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>Este mes</Text>
            </TouchableOpacity>
            {modoFechaCxp !== 'todas' ? (
              <TouchableOpacity
                onPress={() => {
                  setModoFechaCxp('todas');
                  setFechaDesdeCxp('');
                  setFechaHastaCxp('');
                }}
                style={{
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.danger,
                  backgroundColor: colors.surface,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Limpiar fecha</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>

        {modoFechaCxp !== 'todas' ? (
          <View style={{ gap: 6, marginTop: 2 }}>
            {tipo === 'por_pagar' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>Filtrar por:</Text>
                {(
                  [
                    ['cualquiera', 'Solicitud o Enviado a Por Pagar'],
                    ['envio', '📤 Fecha marcado para Por Pagar'],
                    ['solicitud', '📝 Fecha de solicitud / emisión'],
                  ] as const
                ).map(([ck, clbl]) => {
                  const on = campoFechaCxp === ck;
                  return (
                    <TouchableOpacity
                      key={ck}
                      onPress={() => setCampoFechaCxp(ck)}
                      style={{
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: on ? colors.brand : colors.border,
                        backgroundColor: on ? colors.infoSoftBg : colors.surface,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Text style={{ color: on ? colors.brandText : colors.text, fontWeight: on ? '800' : '600', fontSize: 11 }}>
                        {clbl}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {modoFechaCxp === 'dia' ? (
              <View style={{ maxWidth: 260 }}>
                <DateField
                  label="Fecha específica"
                  value={fechaDesdeCxp}
                  onChange={(v) => {
                    setFechaDesdeCxp(v);
                    setFechaHastaCxp(v);
                  }}
                />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 145 }}>
                  <DateField label="Desde" value={fechaDesdeCxp} onChange={setFechaDesdeCxp} />
                </View>
                <View style={{ flex: 1, minWidth: 145 }}>
                  <DateField label="Hasta" value={fechaHastaCxp} onChange={setFechaHastaCxp} />
                </View>
              </View>
            )}
          </View>
        ) : null}
      </View>

      {/* Buscador */}
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Buscar por contraparte, concepto, solicitante, máquina/placa, factura o nota…"
        placeholderTextColor={colors.muted}
        style={[inputStyle, { marginBottom: spacing.xs }]}
      />
      <TouchableOpacity onPress={() => setVerPagadas((v) => !v)} style={{ alignSelf: 'flex-start', marginBottom: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: verPagadas ? colors.brand : colors.border, backgroundColor: verPagadas ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
        <Text style={{ color: verPagadas ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
          {verPagadas ? '✓ Mostrando pagadas y anuladas' : 'Mostrar también pagadas y anuladas'}
        </Text>
      </TouchableOpacity>

      {/* ☑ Marcas para el reporte y aprobación en lote: por id, sobreviven a filtrar y buscar. */}
      {lista.length > 0 || nMarcadas > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setMarcadas((prev) => { const n = new Set(prev); lista.forEach((c) => n.add(c.id)); return n; })}
            style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>☑ Marcar todas (de la lista)</Text>
          </TouchableOpacity>
          {nMarcadas > 0 ? (
            <TouchableOpacity
              onPress={() => setMarcadas(new Set())}
              style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>☐ Quitar marcas</Text>
            </TouchableOpacity>
          ) : null}
          {lista.length > 0 ? (
            <>
              <TouchableOpacity
                onPress={() =>
                  setTarjetasAbiertasIds((prev) => {
                    const next = new Set(prev);
                    lista.forEach((c) => next.add(c.id));
                    return next;
                  })
                }
                style={{
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.brand,
                  backgroundColor: colors.surfaceAlt,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>
                  ▾ Desplegar todas ({lista.length})
                </Text>
              </TouchableOpacity>
              {tarjetasAbiertasIds.size > 0 ? (
                <TouchableOpacity
                  onPress={() => setTarjetasAbiertasIds(new Set())}
                  style={{
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceAlt,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11 }}>
                    ▴ Plegar todas
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
          {tipo === 'por_pagar' && nMarcadas > 0 && (puedeAprobarPagos || role === 'admin') ? (
            (() => {
              const pendientesAprob = ordenadas.filter(
                (c) => marcadas.has(c.id) && c.situacion !== 'pagada' && c.situacion !== 'anulada' && c.aprobacionEstado === 'esperando_aprobacion'
              );
              if (pendientesAprob.length === 0) return null;
              return (
                <TouchableOpacity
                  onPress={() => autorizarPagoLote(pendientesAprob)}
                  style={{
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: colors.successSoftBorder,
                    backgroundColor: colors.successSoftBg,
                    paddingHorizontal: spacing.md,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: colors.successSoftText, fontWeight: '900', fontSize: 11 }}>
                    👔 Autorizar marcadas ({pendientesAprob.length})
                  </Text>
                </TouchableOpacity>
              );
            })()
          ) : null}
          <Text style={{ color: nMarcadas > 0 ? colors.brandText : colors.muted, fontWeight: '800', fontSize: 12 }}>
            {nMarcadas} marcada{nMarcadas === 1 ? '' : 's'}{nMarcadasFuera > 0 ? ` (${nMarcadasFuera} fuera de la lista de ahora)` : ''}
          </Text>
        </View>
      ) : null}

      {lista.length === 0 ? (
        <EmptyState
          title={q ? 'Sin resultados' : `Sin cuentas ${cfg.label.toLowerCase()}`}
          subtitle={q ? 'Prueba con otro texto.' : (tipo === 'por_pagar' ? 'Registra lo que la empresa le debe a sus proveedores.' : 'Registra lo que le deben a la empresa.')}
        />
      ) : lista.map((c) => {
        const st = SIT_INFO[c.situacion];
        const dias = c.fecha_vencimiento ? diasEntre(hoy, c.fecha_vencimiento) : null;
        const vencida = c.situacion === 'vencida';
        const abiertas = c.situacion !== 'pagada' && c.situacion !== 'anulada';
        return (
          <ExpandableCard
            key={c.id}
            open={tarjetasAbiertasIds.has(c.id)}
            onToggle={() => toggleTarjetaCuenta(c.id)}
            // Marca visual de lo VENCIDO: borde rojo grueso a la izquierda —
            // se ve de un vistazo sin tener que leer el badge.
            style={vencida ? { borderLeftWidth: 4, borderLeftColor: colors.danger } : undefined}
            summary={
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                  {/* ☐/☑ Marca para el reporte: el toque se queda en la casilla, no abre la tarjeta. */}
                  <TouchableOpacity
                    onPress={() => alternarMarca(c.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: marcadas.has(c.id) }}
                    accessibilityLabel={`Marcar la cuenta de ${c.contraparte} para el reporte`}
                  >
                    <Text style={{ fontSize: 18, color: marcadas.has(c.id) ? colors.brandText : colors.muted }}>{marcadas.has(c.id) ? '☑' : '☐'}</Text>
                  </TouchableOpacity>
                  <Text style={{ fontWeight: '800', fontSize: 15, color: colors.brandText, flex: 1 }} numberOfLines={1}>{c.contraparte}</Text>
                  {c.prioridad ? <Pill label={PRIORIDAD_INFO[c.prioridad as Prioridad].label} {...toneSoft(colors, PRIORIDAD_INFO[c.prioridad as Prioridad].tone)} /> : null}
                  {tipo === 'por_pagar' && c.esMayorAMil ? (
                    <Pill label="💰 Pago > $1,000 USD" {...toneSoft(colors, 'danger')} />
                  ) : null}
                  <Pill label={st.label} {...toneSoft(colors, st.tone)} />
                </View>
                {/* Estado gerencial de aprobación o espera de pago (solo en Por Pagar cuando sigue abierta) */}
                {tipo === 'por_pagar' && abiertas ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {c.aprobacionEstado === 'esperando_aprobacion' ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.pill,
                          backgroundColor: colors.warningSoftBg,
                          borderWidth: 1,
                          borderColor: colors.warningSoftBorder,
                        }}
                      >
                        <Text style={{ color: colors.warningSoftText, fontSize: 11, fontWeight: '900' }}>
                          👔 Esperando Aprobación de {aprobadoresLabel}
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.pill,
                          backgroundColor: colors.infoSoftBg,
                          borderWidth: 1,
                          borderColor: colors.infoSoftBorder,
                        }}
                      >
                        <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '900' }}>
                          ⏳ Esperando Pago{c.aprobacionInfo?.aprobadoPor ? ` · ✅ Autorizado por ${c.aprobacionInfo.aprobadoPor}` : ''}
                        </Text>
                      </View>
                    )}
                    {c.aprobacionEstado === 'esperando_aprobacion' && (puedeAprobarPagos || role === 'admin') ? (
                      <TouchableOpacity
                        onPress={() => autorizarPagoCuenta(c)}
                        style={{
                          backgroundColor: colors.successSoftBg,
                          borderWidth: 1,
                          borderColor: colors.successSoftBorder,
                          borderRadius: radius.pill,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                        }}
                      >
                        <Text style={{ color: colors.successSoftText, fontSize: 11, fontWeight: '900' }}>
                          👔 Autorizar Pago
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <View style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '800' }}>
                      🏢 {c.empresaNombre}
                    </Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>
                    {c.concepto}{c.documento ? ` · ${c.documento}` : ''}
                  </Text>
                </View>

                {/* Resumen compacto en vista plegada: Solicitante + Destino + Chips de Método de Pago + Vencimiento y Monto */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
                    {tipo === 'por_pagar' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={{ color: colors.text, fontSize: 11 }} numberOfLines={1}>
                          👤 <Text style={{ color: colors.muted, fontWeight: '700' }}>Solicitó:</Text>{' '}
                          <Text style={{ fontWeight: '800' }}>{c.traza.solicitadoPor || '—'}</Text>
                          {c.traza.destinoTexto ? (
                            <Text style={{ color: colors.brandText, fontWeight: '800' }}> · 🚜 {c.traza.destinoTexto}</Text>
                          ) : null}
                        </Text>
                        {c.condicionesPago ? (
                          <View style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                            <Text style={{ color: colors.infoSoftText, fontSize: 10, fontWeight: '800' }}>⏱️ {c.condicionesPago}</Text>
                          </View>
                        ) : null}
                        {c.infoPago.metodosActivos.slice(0, 2).map((met) => (
                          <View key={met} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                            <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '800' }}>{met}</Text>
                          </View>
                        ))}
                        {c.presupuestosCount > 0 ? (
                          <View style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                            <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '800' }}>
                              📄 {c.presupuestosCount} presupuesto{c.presupuestosCount > 1 ? 's' : ''}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                    <Text style={{ color: vencida ? colors.dangerSoftText : colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                      Vence: {fmtFecha(c.fecha_vencimiento)}
                      {dias != null && abiertas ? (dias < 0 ? ` · hace ${Math.abs(dias)} día(s)` : dias === 0 ? ' · HOY' : ` · en ${dias} día(s)`) : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.brandText, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>
                      {usd(c.saldo)}
                    </Text>
                    {c.desgloseIva?.tieneIva ? (
                      <View style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.pill, paddingHorizontal: 5, paddingVertical: 1, marginTop: 1 }}>
                        <Text style={{ color: colors.infoSoftText, fontSize: 9.5, fontWeight: '800' }}>
                          IVA {c.desgloseIva.alicuota}% inc.
                        </Text>
                      </View>
                    ) : null}
                    {tasaBcv && c.saldo > 0 ? (
                      <Text selectable style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700', fontVariant: ['tabular-nums'] as any }}>
                        ≈ {fmtBs(bsFromUsd(c.saldo, tasaBcv))}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            }
            detail={
              <>
                {/* 📋 Ficha de Trazabilidad Completa en Por Pagar (visible al desplegar la tarjeta) */}
                {tipo === 'por_pagar' ? (
                  <View
                    style={{
                      marginBottom: 8,
                      padding: 8,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }}>
                        📋 TRAZABILIDAD DE LA SOLICITUD{c.traza.reqCode ? ` · ${c.traza.reqCode}` : ''}
                      </Text>
                      {c.traza.fechaHoraEnviadoPorPagarTexto || c.traza.enviadoPorPagarPor ? (
                        <View
                          style={{
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                            borderRadius: radius.pill,
                            backgroundColor: colors.infoSoftBg,
                            borderWidth: 1,
                            borderColor: colors.infoSoftBorder,
                          }}
                        >
                          <Text style={{ color: colors.infoSoftText, fontSize: 10.5, fontWeight: '800' }}>
                            📤 Marcado para Por Pagar: {c.traza.enviadoPorPagarPor || 'Compras'}
                            {c.traza.fechaHoraEnviadoPorPagarTexto ? ` · ${c.traza.fechaHoraEnviadoPorPagarTexto}` : ''}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>
                        👤 <Text style={{ color: colors.muted, fontWeight: '700' }}>Solicitado por:</Text>{' '}
                        <Text style={{ fontWeight: '900' }}>{c.traza.solicitadoPor || '—'}</Text>
                        {c.traza.registradoPor && norm(c.traza.registradoPor) !== norm(c.traza.solicitadoPor)
                          ? ` (registró: ${c.traza.registradoPor})`
                          : ''}
                      </Text>
                      {c.traza.fechaHoraSolicitudTexto ? (
                        <Text style={{ color: colors.text, fontSize: 11.5 }}>
                          🕒 <Text style={{ color: colors.muted, fontWeight: '700' }}>Fecha/Hora Solicitud:</Text>{' '}
                          <Text style={{ fontWeight: '800' }}>{c.traza.fechaHoraSolicitudTexto}</Text>
                        </Text>
                      ) : null}
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {c.traza.destinoTexto ? (
                        <Text style={{ color: colors.text, fontSize: 11.5 }}>
                          🚜 <Text style={{ color: colors.muted, fontWeight: '700' }}>Para / Destino:</Text>{' '}
                          <Text style={{ color: colors.brandText, fontWeight: '900' }}>{c.traza.destinoTexto}</Text>
                        </Text>
                      ) : null}
                      {c.traza.areaTexto ? (
                        <Text style={{ color: colors.text, fontSize: 11.5 }}>
                          📍 <Text style={{ color: colors.muted, fontWeight: '700' }}>Área:</Text>{' '}
                          <Text style={{ fontWeight: '800' }}>{c.traza.areaTexto}</Text>
                        </Text>
                      ) : null}
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>
                        🏢 <Text style={{ color: colors.muted, fontWeight: '700' }}>Empresa:</Text>{' '}
                        <Text style={{ fontWeight: '800' }}>{c.empresaNombre}</Text>
                      </Text>
                    </View>

                    {/* 📦 Renglones / Ítems del requerimiento + Botón Modificar Ítems (Jesús Lozada / Aprobador) */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginTop: 2,
                        paddingTop: 4,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => toggleRenglonesCuenta(c.id)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 }}
                      >
                        <Text style={{ color: colors.brandText, fontSize: 11.5, fontWeight: '800' }}>
                          {renglonesAbiertosIds.has(c.id)
                            ? `▲ Ocultar renglones (${c.traza.items.length || 1})`
                            : `▼ Ver renglones / ítems del requerimiento (${c.traza.items.length || 1})`}
                        </Text>
                      </TouchableOpacity>

                      {puedeOperarCxp ? (
                        <TouchableOpacity
                          onPress={() => abrirEditorItemsCxp(c)}
                          style={{
                            borderRadius: radius.pill,
                            borderWidth: 1,
                            borderColor: colors.brand,
                            backgroundColor: colors.surface,
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                          }}
                        >
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }}>
                            ✏️ Modificar ítems (Quitar / Agregar)
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {renglonesAbiertosIds.has(c.id) ? (
                      <View
                        style={{
                          marginTop: 4,
                          padding: 8,
                          borderRadius: radius.sm,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          gap: 4,
                        }}
                      >
                        {(c.traza.items.length > 0
                          ? c.traza.items
                          : [{ item_id: null, name: c.concepto, qty: 1, unit: 'und', est_price: Number(c.monto) || 0, note: null }]
                        ).map((it, idx) => {
                          const qty = Number(it.qty) || 0;
                          const unitP = Number(it.est_price) || 0;
                          const sub = Math.round(qty * unitP * 100) / 100;
                          return (
                            <View
                              key={`item-${c.id}-${idx}`}
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 6,
                                paddingVertical: 2,
                                borderBottomWidth: idx < (c.traza.items.length || 1) - 1 ? 1 : 0,
                                borderBottomColor: colors.border,
                              }}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                                  • {it.name}{' '}
                                  <Text style={{ color: colors.muted, fontWeight: '600' }}>
                                    ({qty} {it.unit || 'und'}{unitP > 0 ? ` × ${usd(unitP)}` : ''})
                                  </Text>
                                </Text>
                                {it.note ? (
                                  <Text style={{ color: colors.muted, fontSize: 10.5 }}>Nota: {it.note}</Text>
                                ) : null}
                              </View>
                              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>
                                {sub > 0 ? usd(sub) : '—'}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* 💳 BLOQUE COMPLETO DE MÉTODOS, CONDICIONES Y DATOS BANCARIOS DE PAGO (visible al desplegar) */}
                {tipo === 'por_pagar' ? (
                  (() => {
                    const ip = c.infoPago;
                    const db = ip.datosBancarios;
                    const rpResumen = extraerReciboPagoCuenta(c);
                    const abonosCuenta = abonos.filter((a) => a.cuenta_id === c.id);
                    const tieneTransferencia = Boolean(db.banco || db.numeroCuenta);
                    const tienePagoMovil = Boolean(db.pagoMovilTelefono || db.pagoMovilBanco);
                    const tieneDigital = Boolean(db.binanceId || db.instruccionesPago || db.capturaPago?.url);

                    return (
                      <View
                        style={{
                          marginBottom: 8,
                          padding: 9,
                          borderRadius: radius.md,
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: ip.alertaTasaEspecial ? colors.warningSoftBorder : colors.border,
                          borderLeftWidth: 3,
                          borderLeftColor: ip.alertaTasaEspecial
                            ? colors.warning
                            : ip.tieneDatosBancarios || c.condicionesPago
                              ? colors.accent
                              : colors.brand,
                          gap: 6,
                        }}
                      >
                        {/* Cabecera del bloque con botones rápidos de Copiar y Configurar/Editar */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }}>
                              💳 MÉTODOS, CONDICIONES Y DATOS DE PAGO
                            </Text>
                            {ip.alertaTasaEspecial ? (
                              <View
                                style={{
                                  backgroundColor: colors.warningSoftBg,
                                  borderWidth: 1,
                                  borderColor: colors.warningSoftBorder,
                                  borderRadius: radius.pill,
                                  paddingHorizontal: 7,
                                  paddingVertical: 1,
                                }}
                              >
                                <Text style={{ color: colors.warningSoftText, fontSize: 10.5, fontWeight: '900' }}>
                                  {ip.alertaTasaEspecial}
                                </Text>
                              </View>
                            ) : null}
                          </View>

                          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <TouchableOpacity
                              onPress={() => copiarTextoPortapapeles(ip.resumenCopiable)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.brand,
                                borderRadius: radius.pill,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                              }}
                            >
                              <Text style={{ color: colors.brandText, fontSize: 10.5, fontWeight: '800' }}>
                                📋 Copiar datos de pago
                              </Text>
                            </TouchableOpacity>
                            {puedeOperarCxp ? (
                              <TouchableOpacity
                                onPress={() => abrirEditorPagoCxp(c)}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                style={{
                                  backgroundColor: colors.infoSoftBg,
                                  borderWidth: 1,
                                  borderColor: colors.infoSoftBorder,
                                  borderRadius: radius.pill,
                                  paddingHorizontal: 8,
                                  paddingVertical: 3,
                                }}
                              >
                                <Text style={{ color: colors.infoSoftText, fontSize: 10.5, fontWeight: '900' }}>
                                  💳 {ip.tieneDatosBancarios || c.condicionesPago ? 'Editar métodos / datos' : '+ Cargar métodos de pago'}
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>

                        {/* Fila de Chips de Métodos de Pago y Condiciones */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                          {c.condicionesPago ? (
                            <View
                              style={{
                                backgroundColor: colors.infoSoftBg,
                                borderWidth: 1,
                                borderColor: colors.infoSoftBorder,
                                borderRadius: radius.pill,
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                              }}
                            >
                              <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '800' }}>
                                ⏱️ {c.condicionesPago}
                              </Text>
                            </View>
                          ) : null}
                          {ip.metodosActivos.map((met) => (
                            <View
                              key={met}
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.brand,
                                borderRadius: radius.pill,
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                              }}
                            >
                              <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                                {met}
                              </Text>
                            </View>
                          ))}
                          {!c.condicionesPago && ip.metodosActivos.length === 0 ? (
                            <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>
                              Sin método o condición especificada aún
                            </Text>
                          ) : null}
                        </View>

                        {/* RIF y Teléfono del Proveedor si están disponibles */}
                        {db.proveedorRif || db.proveedorTelefono ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                            {db.proveedorRif ? (
                              <Text selectable style={{ color: colors.text, fontSize: 11.5 }}>
                                🪪 <Text style={{ color: colors.muted, fontWeight: '700' }}>RIF / C.I.:</Text>{' '}
                                <Text style={{ fontWeight: '800' }}>{db.proveedorRif}</Text>
                              </Text>
                            ) : null}
                            {db.proveedorTelefono ? (
                              <Text selectable style={{ color: colors.text, fontSize: 11.5 }}>
                                📞 <Text style={{ color: colors.muted, fontWeight: '700' }}>Tel:</Text>{' '}
                                <Text style={{ fontWeight: '800' }}>{db.proveedorTelefono}</Text>
                              </Text>
                            ) : null}
                          </View>
                        ) : null}

                        {/* Grilla Responsiva (Móvil 1 columna / PC 2-3 columnas) de Coordenadas Bancarias */}
                        {tieneTransferencia || tienePagoMovil || tieneDigital ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {tieneTransferencia ? (
                              <View
                                style={{
                                  flexGrow: 1,
                                  flexBasis: 220,
                                  minWidth: 200,
                                  backgroundColor: colors.surface,
                                  borderWidth: 1,
                                  borderColor: colors.border,
                                  borderRadius: radius.sm,
                                  padding: 7,
                                  gap: 2,
                                }}
                              >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }}>
                                    🏦 TRANSFERENCIA {db.tipoCuenta ? `(${db.tipoCuenta.toUpperCase()})` : ''}
                                  </Text>
                                  {db.numeroCuenta ? (
                                    <TouchableOpacity
                                      onPress={() => copiarTextoPortapapeles(db.numeroCuenta!, '📋 N° de cuenta copiado.')}
                                    >
                                      <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '800' }}>📋 Copiar Cta</Text>
                                    </TouchableOpacity>
                                  ) : null}
                                </View>
                                {db.banco ? (
                                  <Text selectable style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>
                                    {db.banco}
                                  </Text>
                                ) : null}
                                {db.numeroCuenta ? (
                                  <Text selectable style={{ color: colors.text, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>
                                    Cta: {db.numeroCuenta}
                                  </Text>
                                ) : null}
                                {db.titular || db.rifTitular ? (
                                  <Text selectable style={{ color: colors.muted, fontSize: 11 }}>
                                    Titular: <Text style={{ color: colors.text, fontWeight: '700' }}>{db.titular || db.proveedorNombre}</Text>
                                    {db.rifTitular ? ` · ${db.rifTitular}` : ''}
                                  </Text>
                                ) : null}
                              </View>
                            ) : null}

                            {tienePagoMovil ? (
                              <View
                                style={{
                                  flexGrow: 1,
                                  flexBasis: 210,
                                  minWidth: 190,
                                  backgroundColor: colors.surface,
                                  borderWidth: 1,
                                  borderColor: colors.border,
                                  borderRadius: radius.sm,
                                  padding: 7,
                                  gap: 2,
                                }}
                              >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                  <Text style={{ color: colors.successSoftText, fontSize: 11, fontWeight: '900' }}>
                                    📲 PAGO MÓVIL
                                  </Text>
                                  <TouchableOpacity
                                    onPress={() =>
                                      copiarTextoPortapapeles(
                                        [db.pagoMovilBanco, db.pagoMovilTelefono, db.pagoMovilCedulaRif].filter(Boolean).join(' '),
                                        '📋 Datos de Pago Móvil copiados.',
                                      )
                                    }
                                  >
                                    <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '800' }}>📋 Copiar PM</Text>
                                  </TouchableOpacity>
                                </View>
                                <Text selectable style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>
                                  Banco: {db.pagoMovilBanco || db.banco || 'Por definir'}
                                </Text>
                                <Text selectable style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>
                                  Tel: {db.pagoMovilTelefono || '—'} · C.I./RIF: {db.pagoMovilCedulaRif || db.proveedorRif || '—'}
                                </Text>
                              </View>
                            ) : null}

                            {tieneDigital ? (
                              <View
                                style={{
                                  flexGrow: 1,
                                  flexBasis: 210,
                                  minWidth: 190,
                                  backgroundColor: colors.surface,
                                  borderWidth: 1,
                                  borderColor: colors.border,
                                  borderRadius: radius.sm,
                                  padding: 7,
                                  gap: 3,
                                }}
                              >
                                <Text style={{ color: colors.warningSoftText, fontSize: 11, fontWeight: '900' }}>
                                  🪙 BINANCE / ZELLE / OTROS DATOS
                                </Text>
                                {db.binanceId ? (
                                  <Text selectable style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
                                    ID / Correo: {db.binanceId}
                                  </Text>
                                ) : null}
                                {db.instruccionesPago ? (
                                  <Text selectable style={{ color: colors.text, fontSize: 11.5 }}>
                                    {db.instruccionesPago}
                                  </Text>
                                ) : null}
                                {db.capturaPago?.url ? (
                                  <TouchableOpacity
                                    onPress={() => Linking.openURL(db.capturaPago!.url)}
                                    style={{
                                      alignSelf: 'flex-start',
                                      backgroundColor: colors.infoSoftBg,
                                      borderWidth: 1,
                                      borderColor: colors.infoSoftBorder,
                                      borderRadius: radius.sm,
                                      paddingHorizontal: 8,
                                      paddingVertical: 3,
                                      marginTop: 2,
                                    }}
                                  >
                                    <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '800' }}>
                                      📸 Ver Captura / QR de pago{db.capturaPago.name ? ` (${db.capturaPago.name})` : ''}
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                            <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                              ℹ️ Sin cuenta bancaria, Pago Móvil o Zelle cargado aún en la ficha de este proveedor.
                            </Text>
                          </View>
                        )}

                        {/* Proveedores secundarios si el requerimiento tiene compras multi-proveedor */}
                        {ip.proveedoresSecundarios.length > 0 ? (
                          <View style={{ gap: 3, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 }}>
                            <Text style={{ color: colors.brandText, fontSize: 10.5, fontWeight: '800' }}>
                              👥 Otros proveedores en los ítems de este requerimiento:
                            </Text>
                            {ip.proveedoresSecundarios.map((sec, idxSec) => (
                              <Text key={`sec-sup-${idxSec}`} selectable style={{ color: colors.text, fontSize: 11 }}>
                                • <Text style={{ fontWeight: '800' }}>{sec.proveedorNombre}:</Text>{' '}
                                {[
                                  sec.banco && sec.numeroCuenta ? `🏦 ${sec.banco} ${sec.numeroCuenta}` : null,
                                  sec.pagoMovilTelefono ? `📲 PM: ${sec.pagoMovilBanco || ''} ${sec.pagoMovilTelefono} (${sec.pagoMovilCedulaRif || ''})` : null,
                                  sec.binanceId ? `🪙 ${sec.binanceId}` : null,
                                  sec.instruccionesPago ? sec.instruccionesPago : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </Text>
                            ))}
                          </View>
                        ) : null}

                        {/* Nota / Instrucciones específicas de la cuenta */}
                        {c.notaLimpia ? (
                          <View
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                            }}
                          >
                            <Text selectable style={{ color: colors.text, fontSize: 12, lineHeight: 16 }}>
                              <Text style={{ color: colors.brandText, fontWeight: '900' }}>📝 Nota / Instrucción: </Text>
                              {c.notaLimpia}
                            </Text>
                          </View>
                        ) : null}

                        {/* Resumen si ya tiene Abonos o Comprobante de Pago */}
                        {c.abonado > 0 || rpResumen?.metodo || rpResumen?.referencia ? (
                          <View
                            style={{
                              backgroundColor: colors.successSoftBg,
                              borderWidth: 1,
                              borderColor: colors.successSoftBorder,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 6,
                            }}
                          >
                            <Text style={{ color: colors.successSoftText, fontSize: 11.5, fontWeight: '800', flex: 1 }}>
                              ✅ {c.situacion === 'pagada' ? 'Pagado' : `Abonado ${usd(c.abonado)}`}
                              {rpResumen?.metodo ? ` vía ${rpResumen.metodo}` : ''}
                              {rpResumen?.referencia ? ` · Ref: ${rpResumen.referencia}` : ''}
                              {abonosCuenta.length > 0
                                ? ` (${abonosCuenta.map((a) => `${usd(Number(a.monto) || 0)}${a.metodo ? ` ${a.metodo}` : ''}`).join(', ')})`
                                : ''}
                            </Text>
                            {rpResumen?.url ? (
                              <TouchableOpacity onPress={() => Linking.openURL(rpResumen.url!)}>
                                <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }}>
                                  👁️ Ver comprobante
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })()
                ) : null}
                {/* Desglose financiero con IVA o Monto original */}
                {c.desgloseIva?.tieneIva ? (
                  <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginVertical: 4, gap: 3 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                        📊 DESGLOSE FINANCIERO CON IVA
                      </Text>
                      <View style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: colors.infoSoftText, fontSize: 10, fontWeight: '800' }}>
                          IVA ({c.desgloseIva.alicuota}%)
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        Subtotal: <Text style={{ color: colors.text, fontWeight: '700' }}>{usd(c.desgloseIva.subtotal)}</Text>
                      </Text>
                      {c.desgloseIva.exento > 0 && (
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          Exento: <Text style={{ color: colors.text, fontWeight: '700' }}>{usd(c.desgloseIva.exento)}</Text>
                        </Text>
                      )}
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        Base imponible: <Text style={{ color: colors.text, fontWeight: '700' }}>{usd(c.desgloseIva.baseImponible)}</Text>
                      </Text>
                      <Text style={{ color: colors.infoSoftText || colors.brandText, fontSize: 12, fontWeight: '700' }}>
                        IVA: <Text style={{ color: colors.text, fontWeight: '800' }}>+{usd(c.desgloseIva.montoIva)}</Text>
                      </Text>
                    </View>
                    <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '900', marginTop: 2 }}>
                      Total Factura / Cuenta: {usd(Number(c.monto) || 0)} {c.moneda}
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Monto original: {usd(Number(c.monto) || 0)} {c.moneda}</Text>
                )}
                {/* 💱 Los dos montos: el de la cuenta es en US$; su equivalente en Bs con la tasa BCV de hoy. */}
                {tasaBcv ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    ≈ {fmtBs(bsFromUsd(Number(c.monto) || 0, tasaBcv))} · saldo ≈ {fmtBs(bsFromUsd(c.saldo, tasaBcv))} (tasa BCV de hoy: Bs {tasaBcv.toLocaleString('es-VE')} por $)
                  </Text>
                ) : null}
                <Text style={{ color: colors.muted, fontSize: 13 }}>Abonado: {usd(c.abonado)}</Text>
                <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] as any }}>Saldo: {usd(c.saldo)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Emitida: {fmtFecha(c.fecha_emision)}</Text>
                {c.order_id ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🧾 Atada a una orden de compra</Text> : null}
                {c.condicionesPago ? (
                  <View style={{ marginTop: 6, padding: 8, borderRadius: radius.md, backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder }}>
                    <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '800' }}>💳 CONDICIONES DE PAGO</Text>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 2 }}>{c.condicionesPago}</Text>
                  </View>
                ) : null}
                {c.notaLimpia ? (
                  <View style={{ marginTop: 6, padding: 8, borderRadius: radius.md, backgroundColor: colors.warningSoftBg, borderWidth: 1, borderColor: colors.warningSoftBorder }}>
                    <Text style={{ color: colors.warningSoftText, fontSize: 11, fontWeight: '800' }}>📝 NOTA / DATOS E INSTRUCCIONES DE PAGO</Text>
                    <Text style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>{c.notaLimpia}</Text>
                  </View>
                ) : null}

                {/* 📜 Línea de Tiempo / Histórico del Expediente (Requerimiento + Por Pagar) */}
                {tipo === 'por_pagar' ? (
                  <TimelineExpedienteBox
                    eventos={construirTimelineExpediente({
                      req: c.traza.reqVinculado,
                      cuenta: c,
                      abonos: abonos.filter((a) => a.cuenta_id === c.id),
                      companies,
                      machinery,
                      vehicles,
                    })}
                    titulo="📜 Histórico de movimientos de esta compra"
                  />
                ) : null}

                {/* 📄 Presupuesto(s) / Cotización(es) (1 o varios archivos: fotos / PDFs) */}
                {(() => {
                  const reqVinc = c.traza?.reqVinculado || (c.inventory_requirement_id ? requirements.find((r) => r.id === c.inventory_requirement_id) : null);
                  const presCta = extraerFormatosAdjuntos(c);
                  const presReq = reqVinc ? extraerFormatosAdjuntos(reqVinc) : [];
                  const mapaUrls = new Set<string>();
                  const todosPres: FormatoAdjunto[] = [];
                  for (const item of [...presCta, ...presReq]) {
                    if (item.url && !mapaUrls.has(item.url)) {
                      mapaUrls.add(item.url);
                      todosPres.push(item);
                    }
                  }

                  if (todosPres.length === 0) return null;

                  return (
                    <View style={{ marginTop: spacing.sm, marginBottom: spacing.xs }}>
                      <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                        📄 PRESUPUESTOS Y COTIZACIONES ADJUNTAS ({todosPres.length})
                      </Text>
                      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                        {todosPres.map((p, idx) => (
                          <TouchableOpacity
                            key={`pres-${idx}-${p.url}`}
                            onPress={() => Linking.openURL(p.url)}
                            style={{
                              backgroundColor: colors.surfaceAlt,
                              borderWidth: 1,
                              borderColor: colors.brand,
                              borderRadius: radius.md,
                              paddingHorizontal: spacing.md,
                              paddingVertical: spacing.xs,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            <Text style={{ fontSize: 12 }}>{p.kind === 'pdf' ? '📄' : '🖼️'}</Text>
                            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                              {p.name || `Presupuesto #${idx + 1}`}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  );
                })()}

                {/* Soportes adjuntos: Factura(s) y Comprobante(s) de Pago (1 o más fotos/PDFs) */}
                {(() => {
                  const rp = extraerReciboPagoCuenta(c);
                  const facCta = extraerFacturaCuenta(c);
                  const reqVinc = c.inventory_requirement_id ? requirements.find((r) => r.id === c.inventory_requirement_id) : null;
                  const facReq = reqVinc ? extraerFactura(reqVinc) : null;
                  const recReq = reqVinc ? extraerReciboPago(reqVinc) : null;

                  const listaFacturas: ArchivoSoporte[] =
                    facCta?.archivos && facCta.archivos.length > 0
                      ? facCta.archivos
                      : facReq?.archivos && facReq.archivos.length > 0
                        ? facReq.archivos
                        : c.factura_url
                          ? [{ url: c.factura_url, tipo: c.factura_url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image', nombre: facCta?.nombre || facReq?.nombre || 'Factura' }]
                          : facReq?.url
                            ? [{ url: facReq.url, tipo: facReq.tipo === 'pdf' ? 'pdf' : 'image', nombre: facReq.nombre || 'Factura' }]
                            : [];

                  const listaComprobantes: ArchivoSoporte[] =
                    rp?.archivos && rp.archivos.length > 0
                      ? rp.archivos
                      : recReq?.archivos && recReq.archivos.length > 0
                        ? recReq.archivos
                        : rp?.url
                          ? [{ url: rp.url, tipo: rp.tipo === 'pdf' ? 'pdf' : 'image', nombre: rp.nombre || 'Comprobante de pago' }]
                          : recReq?.url
                            ? [{ url: recReq.url, tipo: recReq.tipo === 'pdf' ? 'pdf' : 'image', nombre: recReq.nombre || 'Comprobante de pago' }]
                            : [];

                  if (listaFacturas.length === 0 && listaComprobantes.length === 0) return null;
                  return (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                      {listaFacturas.map((f, idx) => (
                        <TouchableOpacity
                          key={`fac-${idx}-${f.url}`}
                          onPress={() => Linking.openURL(f.url)}
                          style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                        >
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                            🧾 Ver factura {listaFacturas.length > 1 ? `#${idx + 1}` : ''}{f.nombre ? ` (${f.nombre})` : ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      {listaComprobantes.map((p, idx) => (
                        <TouchableOpacity
                          key={`comp-${idx}-${p.url}`}
                          onPress={() => Linking.openURL(p.url)}
                          style={{ backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                        >
                          <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 12 }}>
                            💳 Ver comprobante {listaComprobantes.length > 1 ? `#${idx + 1}` : ''}{p.nombre ? ` (${p.nombre})` : ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })()}

                {/* Historial de abonos de esta cuenta */}
                {abonos.filter((a) => a.cuenta_id === c.id).length > 0 ? (
                  <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Abonos</Text>
                    {abonos.filter((a) => a.cuenta_id === c.id).map((a) => {
                      const abComp = extraerComprobanteAbono(a);
                      return (
                        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, marginTop: 3 }}>
                          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
                            • {fmtFecha(a.fecha)} · {usd(Number(a.monto) || 0)}{a.metodo ? ` · ${a.metodo}` : ''}{a.referencia ? ` · ${a.referencia}` : ''}
                          </Text>
                          {abComp?.url ? (
                            <TouchableOpacity onPress={() => Linking.openURL(abComp.url!)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11 }}>📎 Soporte</Text>
                            </TouchableOpacity>
                          ) : null}
                          {puedeOperarCxp ? (
                            <TouchableOpacity onPress={() => eliminarAbono(a, c)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11 }}>🗑️ Quitar</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                {/* Subir Factura(s), Subir Comprobante(s) de Pago + Recibo (PDF) */}
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                  {puedeOperarCxp ? (
                    <>
                      <TouchableOpacity
                        onPress={() => abrirSubirFactura(c)}
                        style={{
                          flexGrow: 1,
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.brand,
                          borderRadius: radius.md,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.sm,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>
                          {c.factura_url || extraerFacturaCuenta(c)?.url ? '🧾 Editar / + Fotos Factura' : '🧾 Subir Factura(s)'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => abrirSubirComprobante(c)}
                        style={{
                          flexGrow: 1,
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.successSoftBorder,
                          borderRadius: radius.md,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.sm,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 13 }}>
                          {extraerReciboPagoCuenta(c)?.url ? '💳 Editar / + Fotos Comprobante' : '📤 Subir Comprobante(s) de Pago'}
                        </Text>
                      </TouchableOpacity>
                      {tipo === 'por_pagar' ? (
                        <TouchableOpacity
                          onPress={() => abrirEditorItemsCxp(c)}
                          style={{
                            flexGrow: 1,
                            backgroundColor: colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: colors.warningSoftBorder,
                            borderRadius: radius.md,
                            paddingVertical: spacing.sm,
                            paddingHorizontal: spacing.sm,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 13 }}>
                            ✏️ Modificar Ítems (Quitar / Agregar)
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ) : null}
                  <TouchableOpacity onPress={() => generarRecibo(c)} style={{ flexGrow: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>🧾 {tipo === 'por_cobrar' ? 'Recibo de cobro' : 'Recibo de pago'}</Text>
                  </TouchableOpacity>
                </View>

                {puedeOperarCxp ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                    {abiertas ? (
                      <>
                        {tipo === 'por_pagar' && c.aprobacionEstado === 'esperando_aprobacion' && (puedeAprobarPagos || role === 'admin') ? (
                          <TouchableOpacity
                            onPress={() => autorizarPagoCuenta(c)}
                            style={{
                              flexGrow: 1,
                              backgroundColor: colors.infoSoftBg,
                              borderWidth: 1,
                              borderColor: colors.infoSoftBorder,
                              borderRadius: radius.md,
                              paddingVertical: spacing.sm,
                              alignItems: 'center',
                            }}
                          >
                            <Text style={{ color: colors.infoSoftText, fontWeight: '900', fontSize: 13 }}>👔 Autorizar Pago</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity onPress={() => marcarPagada(c)} style={{ flexGrow: 1, backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                          <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 13 }}>✅ Marcar pagada</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => abrirAbono(c)} style={{ flexGrow: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                          <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 13 }}>💵 Registrar abono</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => abrirEdicion(c)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>✎ Editar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => anular(c)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>⛔ Anular</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity onPress={() => reabrir(c)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>↩ Volver a pendiente</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </>
            }
          />
        );
      })}

      {/* ── Modal: alta / edición ─────────────────────────────────────────── */}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView>
            <SectionTitle>{edit ? 'Editar cuenta' : `Nueva cuenta ${cfg.label.toLowerCase()}`}</SectionTitle>

            {atadaReq ? (
              <Card>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>🔗 Se sincroniza con {reqAtado?.code || 'su requerimiento'}</Text>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>El proveedor, la empresa y la prioridad que cambies aquí pasan al requerimiento y a su orden (y al revés). El monto sale de los renglones del requerimiento.</Text>
              </Card>
            ) : null}

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{cfg.contraparteLabel}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>{proveedorBloqueado ? '🔒 La cuenta ya está pagada: el proveedor queda como se pagó. Para cambiarlo, primero revierte el pago.' : cfg.contraparteHint}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {maestro.map((m) => {
                  const on = contraparteId === m.id;
                  return (
                    <TouchableOpacity key={m.id} disabled={proveedorBloqueado} onPress={() => setContraparteId(m.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{m.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {maestro.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 13 }}>
                    {tipo === 'por_pagar' ? 'No hay proveedores registrados. Créalos en Compras → Proveedores.' : 'No hay empresas registradas.'}
                  </Text>
                ) : null}
              </View>
            </Card>

            {/* Empresa asociada a la cuenta (para compras: qué empresa gasta / para cobros: empresa receptora) */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                {tipo === 'por_pagar' ? '🏢 Empresa solicitante / destino de la compra (opcional)' : '🏢 Empresa receptora del cobro'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
                {tipo === 'por_pagar'
                  ? 'Permite filtrar las deudas por empresa (ej. Golden Touch, Liccione, SOS La Guaira, etc.). Si proviene de un requerimiento se detecta automáticamente.'
                  : 'Empresa receptora asociada a la cuenta.'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => setEmpresaFormId(null)}
                  style={{
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: !empresaFormId ? colors.brand : colors.border,
                    backgroundColor: !empresaFormId ? colors.brand : colors.surfaceAlt,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                  }}
                >
                  <Text style={{ color: !empresaFormId ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                    Sin asignar / Detección automática
                  </Text>
                </TouchableOpacity>
                {companies.map((co) => {
                  const on = empresaFormId === co.id;
                  return (
                    <TouchableOpacity
                      key={co.id}
                      onPress={() => setEmpresaFormId(co.id)}
                      style={{
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: on ? colors.brand : colors.border,
                        backgroundColor: on ? colors.brand : colors.surfaceAlt,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs,
                      }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                        {co.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Concepto (por qué se debe)</Text>
              <TextInput value={concepto} onChangeText={setConcepto} autoCapitalize="sentences" placeholder="Ej. Repuestos factura 0123" placeholderTextColor={colors.muted} style={inputStyle} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Nº de factura / control (opcional)</Text>
              <TextInput value={documento} onChangeText={setDocumento} autoCapitalize="none" placeholder="Ej. F-00123" placeholderTextColor={colors.muted} style={inputStyle} />
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '800', marginBottom: 4 }}>
                💰 Monto e IVA (USD)
              </Text>
              {atadaReq ? (
                <View style={{ gap: 4 }}>
                  <TextInput value={monto} editable={false} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.muted} style={[inputStyle, { opacity: 0.7 }]} />
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    🔒 Monto derivado de los renglones de {reqAtado?.code || 'su requerimiento'}: si requiere cambio, edítalo en el requerimiento.
                  </Text>
                  {(() => {
                    const reqObj = reqAtado || (edit ? requirements.find((r) => r.id === edit.inventory_requirement_id) : null);
                    if (!reqObj || !Array.isArray(reqObj.items) || reqObj.items.length === 0) return null;
                    const rate = Number(tasaBcv) || 1;
                    const lineTot = (it: RequirementLine) => {
                      if (it.modo_precio === 'total' && it.total_usd != null && Number(it.total_usd) > 0) return Number(it.total_usd);
                      const q = Number(it.qty) || 0;
                      const p = it.currency === 'USD' ? (Number(it.est_price) || 0) : ((Number(it.est_price) || 0) / rate);
                      return q * p;
                    };
                    const sub = Math.round(reqObj.items.reduce((s, it) => s + lineTot(it), 0) * 100) / 100;
                    const exe = Math.round(reqObj.items.reduce((s, it) => it.exento ? s + lineTot(it) : s, 0) * 100) / 100;
                    const base = Math.max(0, Math.round((sub - exe) * 100) / 100);
                    const alic = reqObj.iva_alicuota != null ? Number(reqObj.iva_alicuota) : 16;
                    const mIva = alic > 0 ? Math.round(base * (alic / 100) * 100) / 100 : 0;
                    const totCalc = Math.round((sub + mIva) * 100) / 100;
                    return (
                      <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: 8, marginTop: 4, gap: 2 }}>
                        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                          📊 Desglose del Requerimiento:
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                          Subtotal: <Text style={{ color: colors.text, fontWeight: '700' }}>{usd(sub)}</Text>
                          {exe > 0 ? ` · Exento: ${usd(exe)}` : ''} · Base: <Text style={{ color: colors.text, fontWeight: '700' }}>{usd(base)}</Text> · IVA ({alic}%): <Text style={{ color: colors.text, fontWeight: '800' }}>+{usd(mIva)}</Text>
                        </Text>
                        <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '900', marginTop: 2 }}>
                          Total Requerimiento: {usd(totCalc)} USD
                        </Text>
                      </View>
                    );
                  })()}
                </View>
              ) : (
                <View style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Alícuota de IVA a aplicar:</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {(['16', '8', '0'] as const).map((alic) => {
                        const on = aplicaIvaForm && alicuotaIvaForm === alic;
                        return (
                          <TouchableOpacity
                            key={alic}
                            onPress={() => {
                              setAplicaIvaForm(alic !== '0');
                              setAlicuotaIvaForm(alic);
                              const b = parseNum(montoBaseForm || monto);
                              if (b > 0) {
                                const factor = 1 + (Number(alic) / 100);
                                const nuevoTot = Math.round(b * factor * 100) / 100;
                                setMonto(String(nuevoTot));
                              }
                            }}
                            style={{
                              backgroundColor: on ? colors.brand : colors.surfaceAlt,
                              borderWidth: 1,
                              borderColor: on ? colors.brand : colors.border,
                              borderRadius: radius.pill,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                            }}
                          >
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 11, fontWeight: '700' }}>
                              {alic === '0' ? 'Exento (0%)' : `${alic}%`}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Subtotal / Base (sin IVA):</Text>
                  <TextInput
                    value={montoBaseForm}
                    onChangeText={(txt) => {
                      setMontoBaseForm(txt);
                      const baseNum = parseNum(txt);
                      const alicNum = aplicaIvaForm ? (Number(alicuotaIvaForm) || 0) : 0;
                      const tot = Math.round(baseNum * (1 + (alicNum / 100)) * 100) / 100;
                      setMonto(tot > 0 ? String(tot) : txt);
                    }}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    style={inputStyle}
                  />

                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Monto Total a Pagar (con IVA incluido):</Text>
                  <TextInput
                    value={monto}
                    onChangeText={(txt) => {
                      setMonto(txt);
                      const totNum = parseNum(txt);
                      const alicNum = aplicaIvaForm ? (Number(alicuotaIvaForm) || 0) : 0;
                      if (alicNum > 0 && totNum > 0) {
                        const b = Math.round((totNum / (1 + (alicNum / 100))) * 100) / 100;
                        setMontoBaseForm(String(b));
                      } else {
                        setMontoBaseForm(txt);
                      }
                    }}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    style={inputStyle}
                  />

                  {(() => {
                    const totalNum = parseNum(monto);
                    const alicNum = aplicaIvaForm ? (Number(alicuotaIvaForm) || 0) : 0;
                    if (!(totalNum > 0)) return null;
                    const subCalculado = alicNum > 0 ? Math.round((totalNum / (1 + (alicNum / 100))) * 100) / 100 : totalNum;
                    const ivaCalculado = Math.round((totalNum - subCalculado) * 100) / 100;
                    return (
                      <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: 8, marginTop: 4, gap: 2 }}>
                        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                          📊 Resumen de la Cuenta:
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                          Subtotal: <Text style={{ color: colors.text, fontWeight: '700' }}>{usd(subCalculado)}</Text>
                          {alicNum > 0 ? ` · IVA (${alicNum}%): ` : ' · Sin IVA'}
                          {alicNum > 0 ? <Text style={{ color: colors.text, fontWeight: '800' }}>+{usd(ivaCalculado)}</Text> : null}
                        </Text>
                        <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '900', marginTop: 2 }}>
                          Total a Pagar: {usd(totalNum)} USD
                          {tasaBcv ? ` · ≈ ${fmtBs(bsFromUsd(totalNum, tasaBcv))}` : ''}
                        </Text>
                      </View>
                    );
                  })()}
                </View>
              )}
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Fecha de emisión (AAAA-MM-DD)</Text>
              <TextInput value={emision} onChangeText={setEmision} placeholder={hoy} placeholderTextColor={colors.muted} style={inputStyle} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Fecha de vencimiento (AAAA-MM-DD, opcional)</Text>
              <TextInput value={vence} onChangeText={setVence} placeholder="Sin fecha = no vence" placeholderTextColor={colors.muted} style={inputStyle} />
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                {([['Hoy', 0], ['15 días', 15], ['30 días', 30], ['60 días', 60]] as const).map(([lbl, d]) => (
                  <TouchableOpacity key={lbl} onPress={() => setVence(masDias(fechaValida(emision) ? emision : hoy, d))} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                💳 Condiciones de pago (visible directo para Pagos)
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 6 }}>
                Toca una o varias opciones rápidas o escribe la condición específica de este servicio / compra:
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {CONDICIONES_PAGO_CHIPS.map((chipLabel) => {
                  const activo = condicionesPago.toUpperCase().includes(chipLabel.toUpperCase());
                  return (
                    <TouchableOpacity
                      key={chipLabel}
                      onPress={() => {
                        const next = toggleChipCondicionPago(condicionesPago, chipLabel);
                        setCondicionesPago(next);
                        const diasCred = detectarDiasCreditoChip(chipLabel);
                        if (diasCred !== null && !activo) {
                          setVence(masDias(fechaValida(emision) ? emision : hoy, diasCred));
                        }
                      }}
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
                autoCapitalize="sentences"
                placeholder="Ej. 50% de adelanto para iniciar y 50% al entregar factura · Transferencia Bs BCV…"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>📝 Nota / Instrucciones para Pagos (opcional)</Text>
              <TextInput
                value={nota}
                onChangeText={setNota}
                autoCapitalize="sentences"
                multiline
                placeholder="Observación, datos bancarios o aclaratoria para quien va a pagar…"
                placeholderTextColor={colors.muted}
                style={[inputStyle, { minHeight: 58, textAlignVertical: 'top' }]}
              />
            </Card>

            {/* Prioridad (opcional) */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Prioridad (opcional)</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                {(['alta', 'media', 'baja'] as const).map((p) => {
                  const on = prioridad === p;
                  const t = toneSoft(colors, PRIORIDAD_INFO[p].tone);
                  return (
                    <TouchableOpacity key={p} onPress={() => setPrioridad(on ? null : p)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? t.border : colors.border, backgroundColor: on ? t.bg : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? t.text : colors.text, fontWeight: '800', fontSize: 12 }}>{PRIORIDAD_INFO[p].label}</Text>
                    </TouchableOpacity>
                  );
                })}
                {prioridad ? (
                  <TouchableOpacity onPress={() => setPrioridad(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>Quitar ✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </Card>

            {/* Atar a una orden de compra (opcional) */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Atar a una compra (orden, opcional)</Text>
              {atadaReq ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>🔗 Atada a la orden de {reqAtado?.code || 'su requerimiento'}: el vínculo no se cambia aquí.</Text>
              ) : orders.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>No hay órdenes de compra registradas todavía.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  <TouchableOpacity onPress={() => setOrderId(null)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: !orderId ? colors.brand : colors.border, backgroundColor: !orderId ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: !orderId ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>Sin orden</Text>
                  </TouchableOpacity>
                  {orders.map((o) => {
                    const on = orderId === o.id;
                    return (
                      <TouchableOpacity key={o.id} onPress={() => setOrderId(o.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{ordenLabel(o)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </Card>

            {/* Presupuesto / Cotizaciones (uno o varios archivos, imagen o PDF) */}
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '800' }}>
                  📄 Presupuesto / Cotizaciones (uno o varios archivos)
                </Text>
                {presupuestos.length > 0 && (
                  <View style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '800' }}>
                      {presupuestos.length} adjunto{presupuestos.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
                Adjunta fotos o documentos en PDF del presupuesto o cotizaciones recibidas del proveedor (puedes subir varios archivos).
              </Text>

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: presupuestos.length > 0 ? spacing.sm : 0 }}>
                <TouchableOpacity
                  onPress={tomarFotoPresupuesto}
                  disabled={subiendoPresupuesto}
                  style={{
                    flex: 1,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    paddingVertical: spacing.sm,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 6,
                    opacity: subiendoPresupuesto ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontSize: 14 }}>📷</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Tomar foto</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={subirArchivosPresupuesto}
                  disabled={subiendoPresupuesto}
                  style={{
                    flex: 1,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    paddingVertical: spacing.sm,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 6,
                    opacity: subiendoPresupuesto ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontSize: 14 }}>📁</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                    {subiendoPresupuesto ? 'Subiendo…' : 'Subir archivo(s)'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Lista de archivos adjuntos */}
              {presupuestos.length > 0 && (
                <View style={{ gap: 6, marginTop: spacing.xs }}>
                  {presupuestos.map((p, idx) => (
                    <View
                      key={p.id || `pre-${idx}-${p.url}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        gap: spacing.sm,
                      }}
                    >
                      <Text style={{ fontSize: 14 }}>{p.kind === 'pdf' ? '📄' : '🖼️'}</Text>
                      <TouchableOpacity
                        onPress={() => Linking.openURL(p.url)}
                        style={{ flex: 1 }}
                      >
                        <Text
                          numberOfLines={1}
                          style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}
                        >
                          {p.name || `Presupuesto #${idx + 1}`}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => Linking.openURL(p.url)}
                        style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                      >
                        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>Ver</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => quitarPresupuesto(idx)}
                        style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                      >
                        <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </Card>

            {/* Factura (archivo imagen/PDF, opcional) */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Factura (imagen o PDF, opcional)</Text>
              {facturaUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <TouchableOpacity onPress={() => Linking.openURL(facturaUrl)} style={{ flexGrow: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>📎 Ver factura adjunta</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={subirFactura} disabled={subiendoFactura} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>{subiendoFactura ? 'Subiendo…' : 'Reemplazar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setFacturaUrl(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar ✕</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={subirFactura} disabled={subiendoFactura} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendoFactura ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendoFactura ? 'Subiendo…' : '📎 Adjuntar factura'}</Text>
                </TouchableOpacity>
              )}
            </Card>

            {/* Recibo / Comprobante de Pago (archivo imagen/PDF, opcional) */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>💳 Recibo o Comprobante de Pago (transferencia / banco / recibo, opcional)</Text>
              {reciboPagoUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <TouchableOpacity onPress={() => Linking.openURL(reciboPagoUrl)} style={{ flexGrow: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>💳 Ver recibo adjunto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={subirReciboPago} disabled={subiendoReciboPago} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>{subiendoReciboPago ? 'Subiendo…' : 'Reemplazar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setReciboPagoUrl(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar ✕</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={subirReciboPago} disabled={subiendoReciboPago} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendoReciboPago ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendoReciboPago ? 'Subiendo…' : '💳 Adjuntar recibo de pago'}</Text>
                </TouchableOpacity>
              )}
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : edit ? 'Guardar cambios' : 'Guardar cuenta'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: abono (pago parcial) ───────────────────────────────────── */}
      <Modal visible={!!abonoDe} animationType="slide" onRequestClose={() => setAbonoDe(null)}>
        <Screen>
          <ScrollView>
            <SectionTitle>Registrar abono</SectionTitle>
            {abonoDe ? (
              <>
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{abonoDe.contraparte}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{abonoDe.concepto}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '800', marginTop: spacing.xs, fontVariant: ['tabular-nums'] as any }}>
                    Saldo actual: {usd(abonoDe.saldo)}
                    {tasaBcv && abonoDe.saldo > 0 ? ` · ≈ ${fmtBs(bsFromUsd(abonoDe.saldo, tasaBcv))} (BCV: Bs ${tasaBcv.toLocaleString('es-VE')}/$)` : ''}
                  </Text>
                  {abonoDe.infoPago.tieneDatosBancarios || abonoDe.condicionesPago ? (
                    <View style={{ marginTop: 6, padding: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, gap: 3 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }}>💳 DATOS DE PAGO DEL PROVEEDOR</Text>
                        <TouchableOpacity onPress={() => copiarTextoPortapapeles(abonoDe.infoPago.resumenCopiable)}>
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>📋 Copiar datos</Text>
                        </TouchableOpacity>
                      </View>
                      {abonoDe.condicionesPago ? (
                        <Text selectable style={{ color: colors.text, fontSize: 11.5 }}>⏱️ Condiciones: {abonoDe.condicionesPago}</Text>
                      ) : null}
                      {abonoDe.infoPago.datosBancarios.banco || abonoDe.infoPago.datosBancarios.numeroCuenta ? (
                        <Text selectable style={{ color: colors.text, fontSize: 11.5 }}>
                          🏦 {abonoDe.infoPago.datosBancarios.banco || 'Banco'} · Cta: {abonoDe.infoPago.datosBancarios.numeroCuenta || '—'} · RIF/CI: {abonoDe.infoPago.datosBancarios.rifTitular || abonoDe.infoPago.datosBancarios.proveedorRif || '—'}
                        </Text>
                      ) : null}
                      {abonoDe.infoPago.datosBancarios.pagoMovilTelefono ? (
                        <Text selectable style={{ color: colors.text, fontSize: 11.5 }}>
                          📲 Pago Móvil: {abonoDe.infoPago.datosBancarios.pagoMovilBanco || ''} · Tel: {abonoDe.infoPago.datosBancarios.pagoMovilTelefono} · RIF/CI: {abonoDe.infoPago.datosBancarios.pagoMovilCedulaRif || abonoDe.infoPago.datosBancarios.proveedorRif || '—'}
                        </Text>
                      ) : null}
                      {abonoDe.infoPago.datosBancarios.binanceId ? (
                        <Text selectable style={{ color: colors.text, fontSize: 11.5 }}>
                          🪙 Binance / Zelle: {abonoDe.infoPago.datosBancarios.binanceId}
                        </Text>
                      ) : null}
                      {abonoDe.infoPago.datosBancarios.instruccionesPago ? (
                        <Text selectable style={{ color: colors.muted, fontSize: 11 }}>
                          📝 {abonoDe.infoPago.datosBancarios.instruccionesPago}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Monto del abono (USD)</Text>
                  <TextInput value={abMonto} onChangeText={setAbMonto} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.muted} style={inputStyle} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Fecha (AAAA-MM-DD)</Text>
                  <TextInput value={abFecha} onChangeText={setAbFecha} placeholder={hoy} placeholderTextColor={colors.muted} style={inputStyle} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Método de pago (toca o escribe)</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {(['Transferencia Bs (BCV)', 'Pago Móvil', 'Efectivo / Divisas $', 'Zelle', 'Binance / USDT', 'Tasa Euro', 'Punto / Débito'] as const).map((m) => {
                      const on = abMetodo === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          onPress={() => setAbMetodo(on ? '' : m)}
                          style={{
                            borderRadius: radius.pill,
                            borderWidth: 1,
                            borderColor: on ? colors.brand : colors.border,
                            backgroundColor: on ? colors.brand : colors.surfaceAlt,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 5,
                          }}
                        >
                          <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>{m}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput value={abMetodo} onChangeText={setAbMetodo} autoCapitalize="words" placeholder="Efectivo / Transferencia / Pago Móvil / Binance / Zelle" placeholderTextColor={colors.muted} style={inputStyle} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Referencia (opcional)</Text>
                  <TextInput value={abRef} onChangeText={setAbRef} autoCapitalize="none" placeholder="Nº de transferencia / hash / correo" placeholderTextColor={colors.muted} style={inputStyle} />
                </Card>

                {/* Comprobante del abono (opcional) */}
                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>📎 Comprobante de transferencia / pago de este abono (opcional)</Text>
                  {abComprobanteUrl ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                      <TouchableOpacity onPress={() => Linking.openURL(abComprobanteUrl)} style={{ flexGrow: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>📎 Ver soporte adjunto</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setAbComprobanteUrl(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar ✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={subirComprobanteAbono} disabled={subiendoAbComprobante} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendoAbComprobante ? 0.6 : 1 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendoAbComprobante ? 'Subiendo…' : '📎 Adjuntar soporte de abono'}</Text>
                    </TouchableOpacity>
                  )}
                </Card>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                  Saldo después del abono: {usd(Math.max(0, abonoDe.saldo - parseNum(abMonto)))}
                </Text>
              </>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setAbonoDe(null)} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarAbono} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Guardar abono'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Subir Comprobante(s) de Pago directo desde la tarjeta (1 o más fotos/PDFs) ── */}
      <Modal visible={!!comprobanteDe} animationType="slide" onRequestClose={() => setComprobanteDe(null)}>
        <Screen>
          <ScrollView>
            <SectionTitle>💳 Subir Comprobante(s) de Pago</SectionTitle>
            {comprobanteDe ? (
              <>
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{comprobanteDe.contraparte}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{comprobanteDe.concepto}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '800', marginTop: spacing.xs, fontVariant: ['tabular-nums'] as any }}>
                    Monto: {usd(Number(comprobanteDe.monto) || 0)} · Saldo: {usd(comprobanteDe.saldo)}
                  </Text>
                </Card>

                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                    Foto(s) o documento(s) del comprobante / transferencia (puedes subir 1 o varios)
                  </Text>
                  {compArchivos.length > 0 ? (
                    <View style={{ gap: spacing.xs }}>
                      {compArchivos.map((arch, idx) => (
                        <View
                          key={`comp-item-${idx}-${arch.url}`}
                          style={{
                            backgroundColor: colors.successSoftBg,
                            borderWidth: 1,
                            borderColor: colors.successSoftBorder,
                            borderRadius: radius.md,
                            padding: spacing.sm,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: spacing.xs,
                          }}
                        >
                          <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 13, flex: 1 }} numberOfLines={1}>
                            ✓ #{idx + 1} · {arch.nombre || 'Comprobante adjunto'}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                            <TouchableOpacity onPress={() => Linking.openURL(arch.url)} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>👁️ Ver</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => setCompArchivos((prev) => prev.filter((_, i) => i !== idx))}
                              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
                            >
                              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️ Quitar</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        <TouchableOpacity onPress={() => subirArchivoComprobanteDirecto('camara')} disabled={subiendoComp} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoComp ? 0.6 : 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{subiendoComp ? '⏳ Subiendo…' : '📷 + Tomar otra foto'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => subirArchivoComprobanteDirecto('archivo')} disabled={subiendoComp} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoComp ? 0.6 : 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{subiendoComp ? '⏳ Subiendo…' : '📎 + Agregar más fotos/PDFs'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity onPress={() => subirArchivoComprobanteDirecto('camara')} disabled={subiendoComp} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendoComp ? 0.6 : 1 }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendoComp ? '⏳ Subiendo…' : '📷 Tomar foto'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => subirArchivoComprobanteDirecto('archivo')} disabled={subiendoComp} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendoComp ? 0.6 : 1 }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendoComp ? '⏳ Subiendo…' : '📎 Subir fotos / PDFs'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Card>

                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>N° de referencia / comprobante (opcional)</Text>
                  <TextInput value={compRef} onChangeText={setCompRef} placeholder="Ej. Ref #893421 o Voucher 4410" placeholderTextColor={colors.muted} style={inputStyle} />

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Método de pago (opcional)</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {(['Transferencia', 'Pago Móvil', 'Binance / USDT', 'Zelle', 'Efectivo'] as const).map((m) => {
                      const on = compMetodo === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          onPress={() => setCompMetodo(on ? '' : m)}
                          style={{
                            borderRadius: radius.pill,
                            borderWidth: 1,
                            borderColor: on ? colors.brand : colors.border,
                            backgroundColor: on ? colors.brand : colors.surfaceAlt,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 5,
                          }}
                        >
                          <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>{m}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs, marginBottom: 4 }}>Fecha de pago (AAAA-MM-DD)</Text>
                  <TextInput value={compFecha} onChangeText={setCompFecha} placeholder={hoy} placeholderTextColor={colors.muted} style={inputStyle} />

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>📝 Nota del pago (opcional)</Text>
                  <TextInput value={compNota} onChangeText={setCompNota} placeholder="Ej. Pagado desde cuenta Banesco, tasa acordada…" placeholderTextColor={colors.muted} style={inputStyle} />

                  {comprobanteDe.estado !== 'pagada' ? (
                    <TouchableOpacity
                      onPress={() => setCompMarcarPagada((v) => !v)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: spacing.md,
                        padding: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor: compMarcarPagada ? colors.successSoftBg : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: compMarcarPagada ? colors.successSoftBorder : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 16, color: compMarcarPagada ? colors.successSoftText : colors.muted }}>
                        {compMarcarPagada ? '☑' : '☐'}
                      </Text>
                      <Text style={{ color: compMarcarPagada ? colors.successSoftText : colors.text, fontWeight: '800', fontSize: 12.5, flex: 1 }}>
                        Marcar también esta cuenta como PAGADA al guardar (se reflejará en Requerimientos)
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </Card>
              </>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setComprobanteDe(null)} disabled={guardandoComp} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarComprobanteDirecto} disabled={guardandoComp || subiendoComp} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardandoComp || subiendoComp ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{guardandoComp ? 'Guardando…' : '💾 Guardar comprobante(s)'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Subir Factura(s) directo desde la tarjeta (1 o más fotos/PDFs) ── */}
      <Modal visible={!!facturaDe} animationType="slide" onRequestClose={() => setFacturaDe(null)}>
        <Screen>
          <ScrollView>
            <SectionTitle>🧾 Subir Factura(s) Fiscal / Comercial</SectionTitle>
            {facturaDe ? (
              <>
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{facturaDe.contraparte}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{facturaDe.concepto}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '800', marginTop: spacing.xs, fontVariant: ['tabular-nums'] as any }}>
                    Monto: {usd(Number(facturaDe.monto) || 0)} · Saldo: {usd(facturaDe.saldo)}
                  </Text>
                </Card>

                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                    Foto(s) o documento(s) de la factura (puedes adjuntar 1 o varias imágenes/PDFs)
                  </Text>
                  {facArchivos.length > 0 ? (
                    <View style={{ gap: spacing.xs }}>
                      {facArchivos.map((arch, idx) => (
                        <View
                          key={`fac-item-${idx}-${arch.url}`}
                          style={{
                            backgroundColor: colors.infoSoftBg,
                            borderWidth: 1,
                            borderColor: colors.infoSoftBorder,
                            borderRadius: radius.md,
                            padding: spacing.sm,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: spacing.xs,
                          }}
                        >
                          <Text style={{ color: colors.infoSoftText, fontWeight: '800', fontSize: 13, flex: 1 }} numberOfLines={1}>
                            ✓ #{idx + 1} · {arch.nombre || 'Factura adjunta'}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                            <TouchableOpacity onPress={() => Linking.openURL(arch.url)} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>👁️ Ver</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => setFacArchivos((prev) => prev.filter((_, i) => i !== idx))}
                              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
                            >
                              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️ Quitar</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        <TouchableOpacity onPress={() => subirArchivoFacturaDirecta('camara')} disabled={subiendoFacDirecta} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoFacDirecta ? 0.6 : 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{subiendoFacDirecta ? '⏳ Subiendo…' : '📷 + Tomar otra foto'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => subirArchivoFacturaDirecta('archivo')} disabled={subiendoFacDirecta} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoFacDirecta ? 0.6 : 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{subiendoFacDirecta ? '⏳ Subiendo…' : '📎 + Agregar más fotos/PDFs'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity onPress={() => subirArchivoFacturaDirecta('camara')} disabled={subiendoFacDirecta} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendoFacDirecta ? 0.6 : 1 }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendoFacDirecta ? '⏳ Subiendo…' : '📷 Tomar foto'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => subirArchivoFacturaDirecta('archivo')} disabled={subiendoFacDirecta} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendoFacDirecta ? 0.6 : 1 }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendoFacDirecta ? '⏳ Subiendo…' : '📎 Subir fotos / PDFs'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Card>

                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>N° de factura / control (opcional)</Text>
                  <TextInput value={facNumero} onChangeText={setFacNumero} placeholder="Ej. F-004512" placeholderTextColor={colors.muted} style={inputStyle} />

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Proveedor / Empresa emisora de la factura</Text>
                  <TextInput value={facEmpresa} onChangeText={setFacEmpresa} placeholder="Nombre del proveedor o razón social…" placeholderTextColor={colors.muted} style={inputStyle} />
                  {suppliers.length > 0 ? (
                    <View style={{ marginTop: 6 }}>
                      <TouchableOpacity
                        onPress={() => setFacProvOpen((o) => !o)}
                        style={{ alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
                      >
                        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11 }}>
                          {facProvOpen ? '▲ Ocultar catálogo de proveedores' : '🔍 Elegir de proveedores registrados'}
                        </Text>
                      </TouchableOpacity>
                      {facProvOpen ? (
                        <View style={{ marginTop: 6, padding: 8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                          <TextInput
                            value={facProvQ}
                            onChangeText={setFacProvQ}
                            placeholder="Buscar proveedor…"
                            placeholderTextColor={colors.muted}
                            style={[inputStyle, { paddingVertical: 4, fontSize: 12, marginBottom: 6 }]}
                          />
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxHeight: 140 }}>
                            {suppliers
                              .filter((s) => !facProvQ || matchNorm(norm(facProvQ), s.name))
                              .slice(0, 25)
                              .map((s) => (
                                <TouchableOpacity
                                  key={s.id}
                                  onPress={() => {
                                    setFacEmpresa(s.name);
                                    setFacProvOpen(false);
                                  }}
                                  style={{
                                    borderRadius: radius.pill,
                                    borderWidth: 1,
                                    borderColor: norm(facEmpresa) === norm(s.name) ? colors.brand : colors.border,
                                    backgroundColor: norm(facEmpresa) === norm(s.name) ? colors.brand : colors.surface,
                                    paddingHorizontal: spacing.sm,
                                    paddingVertical: 4,
                                  }}
                                >
                                  <Text style={{ color: norm(facEmpresa) === norm(s.name) ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>
                                    {s.name}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Fecha de factura (AAAA-MM-DD)</Text>
                  <TextInput value={facFecha} onChangeText={setFacFecha} placeholder={hoy} placeholderTextColor={colors.muted} style={inputStyle} />

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>📝 Nota de la factura (opcional)</Text>
                  <TextInput value={facNota} onChangeText={setFacNota} placeholder="Observación sobre IVA, retención o entrega…" placeholderTextColor={colors.muted} style={inputStyle} />
                </Card>
              </>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setFacturaDe(null)} disabled={guardandoFacDirecta} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarFacturaDirecta} disabled={guardandoFacDirecta || subiendoFacDirecta} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardandoFacDirecta || subiendoFacDirecta ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{guardandoFacDirecta ? 'Guardando…' : '💾 Guardar factura(s)'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Configurar Usuario Designado Aprobador de Pagos (Anthony / Angelica) ── */}
      <Modal visible={configModalOpen} animationType="slide" onRequestClose={() => setConfigModalOpen(false)}>
        <Screen>
          <ScrollView>
            <SectionTitle>⚙️ Configurar Aprobación Gerencial en Por Pagar</SectionTitle>
            <Card>
              <TouchableOpacity
                onPress={() => setCfgActivo((v) => !v)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: cfgActivo ? colors.successSoftBg : colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: cfgActivo ? colors.successSoftBorder : colors.border,
                }}
              >
                <Text style={{ fontSize: 16, color: cfgActivo ? colors.successSoftText : colors.muted }}>
                  {cfgActivo ? '☑' : '☐'}
                </Text>
                <Text style={{ color: cfgActivo ? colors.successSoftText : colors.text, fontWeight: '800', fontSize: 13, flex: 1 }}>
                  Exigir aprobación del Gerente General / Usuario Designado en Por Pagar
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => setCfgExigirEnTodos(true)}
                  style={{
                    flex: 1,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: cfgExigirEnTodos ? colors.brand : colors.border,
                    backgroundColor: cfgExigirEnTodos ? colors.brand : colors.surfaceAlt,
                    paddingVertical: spacing.sm,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: cfgExigirEnTodos ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
                    En todas las cuentas
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setCfgExigirEnTodos(false);
                    if (!parseNum(cfgMonto)) setCfgMonto('1000');
                  }}
                  style={{
                    flex: 1,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: !cfgExigirEnTodos ? colors.brand : colors.border,
                    backgroundColor: !cfgExigirEnTodos ? colors.brand : colors.surfaceAlt,
                    paddingVertical: spacing.sm,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: !cfgExigirEnTodos ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
                    Solo mayores a un monto
                  </Text>
                </TouchableOpacity>
              </View>

              {!cfgExigirEnTodos ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Monto mínimo en USD (ej. 1000):</Text>
                  <TextInput value={cfgMonto} onChangeText={setCfgMonto} keyboardType="numeric" placeholder="1000" placeholderTextColor={colors.muted} style={inputStyle} />
                </View>
              ) : null}
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>
                👔 Usuario(s) Designado(s) para Aprobar Pagos
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
                Selecciona quiénes autorizan pagos en Por Pagar (actual: {cfgAprobadoresNombres.join(', ') || 'Gerente General'}):
              </Text>
              <TextInput
                value={cfgUserSearch}
                onChangeText={setCfgUserSearch}
                placeholder="Buscar usuario por nombre o cargo…"
                placeholderTextColor={colors.muted}
                style={[inputStyle, { marginBottom: spacing.xs }]}
              />
              <View style={{ gap: 6, maxHeight: 260 }}>
                {usuariosSistema
                  .filter(
                    (u) =>
                      !cfgUserSearch ||
                      matchNorm(norm(cfgUserSearch), `${u.full_name} ${u.role || ''} ${u.app_role_name || ''}`)
                  )
                  .slice(0, 30)
                  .map((u) => {
                    const sel =
                      cfgAprobadoresIds.includes(u.id) ||
                      cfgAprobadoresNombres.some((n) => norm(n) === norm(u.full_name));
                    return (
                      <TouchableOpacity
                        key={u.id}
                        onPress={() => toggleUsuarioAprobadorCxp(u)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 8,
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: sel ? colors.brand : colors.border,
                          backgroundColor: sel ? colors.infoSoftBg : colors.surfaceAlt,
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: sel ? '800' : '600', fontSize: 13 }}>
                          {sel ? '☑ ' : '☐ '}
                          {u.full_name}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {u.app_role_name || u.role || ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setConfigModalOpen(false)} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarConfigAprobadorModal} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>💾 Guardar configuración</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Modificar Ítems del Requerimiento desde Por Pagar (Jesús Lozada / Aprobador / Admin) ── */}
      <Modal visible={!!editItemsCuenta} animationType="slide" onRequestClose={() => setEditItemsCuenta(null)}>
        <Screen>
          <ScrollView>
            <SectionTitle>✏️ Modificar Ítems en Por Pagar</SectionTitle>
            {editItemsCuenta ? (
              <>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 15, flex: 1 }}>
                      {editItemsCuenta.contraparte}
                    </Text>
                    {editItemsCuenta.traza.reqCode ? (
                      <Pill label={`🔗 ${editItemsCuenta.traza.reqCode}`} {...toneSoft(colors, 'info')} />
                    ) : null}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                    Todo ítem que quites, agregues o modifiques aquí se actualiza inmediatamente en el Requerimiento de Compra y en esta cuenta Por Pagar, quedando registrado en el 📜 Histórico.
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    <Text style={{ color: colors.text, fontSize: 11.5 }}>
                      👤 Solicitó: <Text style={{ fontWeight: '800' }}>{editItemsCuenta.traza.solicitadoPor}</Text>
                    </Text>
                    {editItemsCuenta.traza.destinoTexto ? (
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>
                        🚜 Para: <Text style={{ color: colors.brandText, fontWeight: '900' }}>{editItemsCuenta.traza.destinoTexto}</Text>
                      </Text>
                    ) : null}
                  </View>
                </Card>

                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                    <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>
                      📦 Renglones / Ítems ({editItemsDraft.length})
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        setEditItemsDraft((prev) => [
                          ...prev,
                          { name: '', qty: '1', unit: 'und', unitUsd: '', note: '', exento: false, item_id: null },
                        ])
                      }
                      style={{
                        borderRadius: radius.pill,
                        backgroundColor: colors.brand,
                        paddingHorizontal: spacing.md,
                        paddingVertical: 5,
                      }}
                    >
                      <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>
                        ➕ Agregar ítem
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ gap: spacing.sm }}>
                    {editItemsDraft.map((line, idx) => {
                      const qNum = parseNum(line.qty);
                      const pNum = parseNum(line.unitUsd);
                      const sub = Math.round(qNum * pNum * 100) / 100;
                      return (
                        <View
                          key={`draft-cxp-${idx}`}
                          style={{
                            padding: spacing.sm,
                            borderRadius: radius.md,
                            backgroundColor: colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: colors.border,
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 12 }}>
                              Ítem #{idx + 1} · Subtotal: {usd(sub)}
                            </Text>
                            <TouchableOpacity
                              onPress={() => {
                                if (editItemsDraft.length <= 1) {
                                  toast.error('Debe quedar al menos 1 ítem. Para cancelar toda la compra usa ⛔ Anular.');
                                  return;
                                }
                                setEditItemsDraft((prev) => prev.filter((_, i) => i !== idx));
                              }}
                              style={{
                                borderRadius: radius.pill,
                                borderWidth: 1,
                                borderColor: colors.danger,
                                backgroundColor: colors.surface,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                              }}
                            >
                              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>
                                🗑️ Quitar ítem
                              </Text>
                            </TouchableOpacity>
                          </View>

                          <View>
                            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Nombre / Descripción del ítem</Text>
                            <TextInput
                              value={line.name}
                              onChangeText={(v) =>
                                setEditItemsDraft((prev) => prev.map((it, i) => (i === idx ? { ...it, name: v } : it)))
                              }
                              placeholder="Ej. Filtro hidráulico / Aceite 15W40…"
                              placeholderTextColor={colors.muted}
                              style={inputStyle}
                            />
                          </View>

                          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                            <View style={{ flex: 1, minWidth: 85 }}>
                              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cantidad</Text>
                              <TextInput
                                value={line.qty}
                                onChangeText={(v) =>
                                  setEditItemsDraft((prev) => prev.map((it, i) => (i === idx ? { ...it, qty: v } : it)))
                                }
                                keyboardType="numeric"
                                placeholder="1"
                                placeholderTextColor={colors.muted}
                                style={inputStyle}
                              />
                            </View>
                            <View style={{ flex: 1, minWidth: 85 }}>
                              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Unidad</Text>
                              <TextInput
                                value={line.unit}
                                onChangeText={(v) =>
                                  setEditItemsDraft((prev) => prev.map((it, i) => (i === idx ? { ...it, unit: v } : it)))
                                }
                                placeholder="und"
                                placeholderTextColor={colors.muted}
                                style={inputStyle}
                              />
                            </View>
                            <View style={{ flex: 1.3, minWidth: 110 }}>
                              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio Unitario ($ USD)</Text>
                              <TextInput
                                value={line.unitUsd}
                                onChangeText={(v) =>
                                  setEditItemsDraft((prev) => prev.map((it, i) => (i === idx ? { ...it, unitUsd: v } : it)))
                                }
                                keyboardType="numeric"
                                placeholder="0.00"
                                placeholderTextColor={colors.muted}
                                style={inputStyle}
                              />
                            </View>
                          </View>

                          <View>
                            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Nota / Especificación (opcional)</Text>
                            <TextInput
                              value={line.note}
                              onChangeText={(v) =>
                                setEditItemsDraft((prev) => prev.map((it, i) => (i === idx ? { ...it, note: v } : it)))
                              }
                              placeholder="Marca, serial o aclaratoria…"
                              placeholderTextColor={colors.muted}
                              style={[inputStyle, { paddingVertical: 6, fontSize: 12 }]}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </Card>

                {/* Resumen de impacto antes vs después y motivo */}
                {(() => {
                  const subBruto = editItemsDraft.reduce(
                    (acc, l) => acc + (parseNum(l.qty) > 0 ? parseNum(l.qty) : 0) * (parseNum(l.unitUsd) > 0 ? parseNum(l.unitUsd) : 0),
                    0
                  );
                  const baseGrav = editItemsDraft.reduce(
                    (acc, l) => acc + (l.exento ? 0 : (parseNum(l.qty) > 0 ? parseNum(l.qty) : 0) * (parseNum(l.unitUsd) > 0 ? parseNum(l.unitUsd) : 0)),
                    0
                  );
                  const ivaM = editItemsIvaAlicuota > 0 ? Math.round(baseGrav * (editItemsIvaAlicuota / 100) * 100) / 100 : 0;
                  const nuevoTotal = Math.round((subBruto + ivaM) * 100) / 100;
                  const antesTotal = Number(editItemsCuenta.monto) || 0;
                  return (
                    <Card>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <View>
                          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>MONTO ANTERIOR</Text>
                          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{usd(antesTotal)}</Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 18, fontWeight: '900' }}>→</Text>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                            NUEVO MONTO TOTAL{editItemsIvaAlicuota > 0 ? ` (incl. IVA ${editItemsIvaAlicuota}%)` : ''}
                          </Text>
                          <Text style={{ color: colors.brandText, fontSize: 18, fontWeight: '900' }}>{usd(nuevoTotal)}</Text>
                        </View>
                      </View>

                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                        📝 Motivo o nota del ajuste (opcional, se guardará en el Histórico):
                      </Text>
                      <TextInput
                        value={editItemsMotivo}
                        onChangeText={setEditItemsMotivo}
                        placeholder="Ej. Se retiró ítem que ya había en almacén / Se ajustó cantidad autorizada por Gerencia…"
                        placeholderTextColor={colors.muted}
                        style={inputStyle}
                      />
                    </Card>
                  );
                })()}
              </>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setEditItemsCuenta(null)}
                disabled={guardandoItemsCxp}
                style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={guardarModificacionItemsCxp}
                disabled={guardandoItemsCxp}
                style={{ flex: 1.3, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardandoItemsCxp ? 0.6 : 1 }}
              >
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>
                  {guardandoItemsCxp ? '⏳ Sincronizando…' : '💾 Guardar y Sincronizar Requerimiento'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Configurar Métodos de Pago, Condiciones y Datos Bancarios del Proveedor desde Por Pagar ── */}
      <Modal visible={!!pagoModalCuenta} animationType="slide" onRequestClose={() => setPagoModalCuenta(null)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>💳 Configurar Métodos y Datos de Pago</SectionTitle>
            {pagoModalCuenta ? (
              <>
                <Card>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 15 }}>
                    {pagoModalCuenta.contraparte}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    {pagoModalCuenta.concepto}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 4 }}>
                    Saldo por pagar: {usd(pagoModalCuenta.saldo)}
                    {tasaBcv && pagoModalCuenta.saldo > 0
                      ? ` · ≈ ${fmtBs(bsFromUsd(pagoModalCuenta.saldo, tasaBcv))} (BCV: Bs ${tasaBcv.toLocaleString('es-VE')}/$)`
                      : ''}
                  </Text>
                </Card>

                {/* 1. Condiciones y Métodos de Pago de esta Cuenta */}
                <Card>
                  <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '900', marginBottom: 4 }}>
                    1. Método(s) de Pago, Tasa y Condiciones de esta cuenta
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 8 }}>
                    Toca uno o varios chips (ej. Contado, Pago Móvil, Transferencia Bancaria, Tasa BCV, Tasa Euro, Divisas…) o escríbelo abajo:
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {CONDICIONES_PAGO_CHIPS.map((chipLabel) => {
                      const activo = pmCondiciones.toUpperCase().includes(chipLabel.toUpperCase());
                      return (
                        <TouchableOpacity
                          key={chipLabel}
                          onPress={() => {
                            const next = toggleChipCondicionPago(pmCondiciones, chipLabel);
                            setPmCondiciones(next);
                            const diasCred = detectarDiasCreditoChip(chipLabel);
                            if (diasCred !== null && !activo) {
                              setPmVence(
                                masDias(
                                  fechaValida(pagoModalCuenta.fecha_emision || '') ? pagoModalCuenta.fecha_emision! : hoy,
                                  diasCred,
                                ),
                              );
                            }
                          }}
                          style={{
                            borderRadius: radius.pill,
                            borderWidth: 1,
                            borderColor: activo ? colors.brand : colors.border,
                            backgroundColor: activo ? colors.brand : colors.surfaceAlt,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 5,
                          }}
                        >
                          <Text style={{ color: activo ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>
                            {activo ? `✓ ${chipLabel}` : chipLabel}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    value={pmCondiciones}
                    onChangeText={setPmCondiciones}
                    placeholder="Ej. CONTADO · PAGO MÓVIL · TASA BCV / TASA EURO…"
                    placeholderTextColor={colors.muted}
                    style={inputStyle}
                  />

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                    📝 Nota / Instrucción de pago de esta cuenta (opcional)
                  </Text>
                  <TextInput
                    value={pmNotaCuenta}
                    onChangeText={setPmNotaCuenta}
                    multiline
                    placeholder="Ej. Pagar a tasa Euro, enviar capture a administración…"
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, { minHeight: 54, textAlignVertical: 'top' }]}
                  />

                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                    📅 Fecha de vencimiento (AAAA-MM-DD, opcional)
                  </Text>
                  <TextInput
                    value={pmVence}
                    onChangeText={setPmVence}
                    placeholder="Sin fecha = no vence"
                    placeholderTextColor={colors.muted}
                    style={inputStyle}
                  />
                </Card>

                {/* 2. Ficha Bancaria y de Pago del Proveedor (se guarda en Proveedores para todas sus cuentas) */}
                <Card>
                  <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '900', marginBottom: 2 }}>
                    2. Coordenadas Bancarias y Métodos del Proveedor ({pmSupNombre || pagoModalCuenta.contraparte})
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 8 }}>
                    Lo que guardes aquí actualiza automáticamente la ficha del proveedor para todas sus compras y cuentas por pagar.
                  </Text>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    <View style={{ flex: 1, minWidth: 140 }}>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>🪪 RIF / Cédula del Proveedor</Text>
                      <TextInput
                        value={pmSupRif}
                        onChangeText={(t) => setPmSupRif(t.toUpperCase())}
                        placeholder="Ej. J-50123456-7 o V-12345678"
                        placeholderTextColor={colors.muted}
                        style={inputStyle}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 140 }}>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>📞 Teléfono de contacto</Text>
                      <TextInput
                        value={pmSupPhone}
                        onChangeText={setPmSupPhone}
                        placeholder="Ej. 0414-1234567"
                        placeholderTextColor={colors.muted}
                        style={inputStyle}
                      />
                    </View>
                  </View>

                  {/* Sub-bloque: Transferencia Bancaria */}
                  <View
                    style={{
                      marginTop: spacing.sm,
                      padding: spacing.sm,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '900' }}>
                      🏦 Transferencia Bancaria Nacional
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      <View style={{ flex: 1.4, minWidth: 150 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Banco</Text>
                        <TextInput
                          value={pmBankName}
                          onChangeText={setPmBankName}
                          placeholder="Ej. Banesco, Mercantil, Provincial, BDV…"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 120 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Tipo de cuenta</Text>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {(['Corriente', 'Ahorro'] as const).map((tc) => {
                            const on = pmAccountType.toLowerCase() === tc.toLowerCase();
                            return (
                              <TouchableOpacity
                                key={tc}
                                onPress={() => setPmAccountType(tc)}
                                style={{
                                  flex: 1,
                                  borderRadius: radius.md,
                                  borderWidth: 1,
                                  borderColor: on ? colors.brand : colors.border,
                                  backgroundColor: on ? colors.brand : colors.surface,
                                  paddingVertical: 8,
                                  alignItems: 'center',
                                }}
                              >
                                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
                                  {tc}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    </View>

                    <View>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Número de cuenta (20 dígitos)</Text>
                      <TextInput
                        value={pmAccountNumber}
                        onChangeText={setPmAccountNumber}
                        keyboardType="numeric"
                        placeholder="0134-0000-00-0000000000"
                        placeholderTextColor={colors.muted}
                        style={inputStyle}
                      />
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      <View style={{ flex: 1.3, minWidth: 150 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Titular de la cuenta</Text>
                        <TextInput
                          value={pmAccountHolder}
                          onChangeText={setPmAccountHolder}
                          placeholder="Nombre o razón social del titular"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 130 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>RIF / C.I. del titular</Text>
                        <TextInput
                          value={pmAccountIdDoc}
                          onChangeText={(t) => setPmAccountIdDoc(t.toUpperCase())}
                          placeholder="J-00000000-0 / V-00000000"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                    </View>
                  </View>

                  {/* Sub-bloque: Pago Móvil */}
                  <View
                    style={{
                      marginTop: spacing.sm,
                      padding: spacing.sm,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: colors.successSoftText, fontSize: 12, fontWeight: '900' }}>
                      📲 Pago Móvil
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      <View style={{ flex: 1, minWidth: 130 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Banco Pago Móvil</Text>
                        <TextInput
                          value={pmPagoMovilBank}
                          onChangeText={setPmPagoMovilBank}
                          placeholder="Ej. 0134 Banesco"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 130 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Teléfono Pago Móvil</Text>
                        <TextInput
                          value={pmPagoMovilPhone}
                          onChangeText={setPmPagoMovilPhone}
                          keyboardType="phone-pad"
                          placeholder="0412-0000000"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 130 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>C.I. / RIF Pago Móvil</Text>
                        <TextInput
                          value={pmPagoMovilId}
                          onChangeText={(t) => setPmPagoMovilId(t.toUpperCase())}
                          placeholder="V-12345678 / J-50000000"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                    </View>
                  </View>

                  {/* Sub-bloque: Binance / Zelle / Divisas / Captura QR */}
                  <View
                    style={{
                      marginTop: spacing.sm,
                      padding: spacing.sm,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: colors.warningSoftText, fontSize: 12, fontWeight: '900' }}>
                      🪙 Binance / 💸 Zelle / 💵 Divisas y Captura QR
                    </Text>
                    <View>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>
                        Binance Pay ID / Correo Zelle / Billetera USDT
                      </Text>
                      <TextInput
                        value={pmBinanceId}
                        onChangeText={setPmBinanceId}
                        autoCapitalize="none"
                        placeholder="Correo, Pay ID o dirección USDT…"
                        placeholderTextColor={colors.muted}
                        style={inputStyle}
                      />
                    </View>
                    <View>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>
                        Notas de pago adicionales del proveedor (Zelle, Efectivo, Cuenta Internacional…)
                      </Text>
                      <TextInput
                        value={pmPaymentNotes}
                        onChangeText={setPmPaymentNotes}
                        multiline
                        placeholder="Ej. Zelle a nombre de…, o acepta efectivo USD en tienda…"
                        placeholderTextColor={colors.muted}
                        style={[inputStyle, { minHeight: 50, textAlignVertical: 'top' }]}
                      />
                    </View>

                    {/* Captura / QR de datos de pago */}
                    {pmCapturaUrl ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                        <TouchableOpacity
                          onPress={() => Linking.openURL(pmCapturaUrl)}
                          style={{
                            flex: 1,
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.brand,
                            borderRadius: radius.md,
                            paddingVertical: spacing.xs,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                            📸 Ver captura / QR ({pmCapturaName || 'Imagen'})
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            setPmCapturaUrl(null);
                            setPmCapturaName(null);
                          }}
                          style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}
                        >
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar ✕</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        <TouchableOpacity
                          onPress={() => subirCapturaPagoProvCxp('camara')}
                          disabled={pmSubiendoCaptura}
                          style={{
                            flex: 1,
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: radius.md,
                            paddingVertical: spacing.sm,
                            alignItems: 'center',
                            opacity: pmSubiendoCaptura ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                            {pmSubiendoCaptura ? '⏳ Subiendo…' : '📷 Foto de QR / Datos'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => subirCapturaPagoProvCxp('archivo')}
                          disabled={pmSubiendoCaptura}
                          style={{
                            flex: 1,
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: radius.md,
                            paddingVertical: spacing.sm,
                            alignItems: 'center',
                            opacity: pmSubiendoCaptura ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                            {pmSubiendoCaptura ? '⏳ Subiendo…' : '📎 Adjuntar QR / Captura'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </Card>
              </>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity
                onPress={() => setPagoModalCuenta(null)}
                disabled={pmGuardando}
                style={{
                  flex: 1,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  paddingVertical: spacing.md,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={guardarEditorPagoCxp}
                disabled={pmGuardando || pmSubiendoCaptura}
                style={{
                  flex: 1.3,
                  backgroundColor: colors.accent,
                  borderRadius: radius.md,
                  paddingVertical: spacing.md,
                  alignItems: 'center',
                  opacity: pmGuardando || pmSubiendoCaptura ? 0.6 : 1,
                }}
              >
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>
                  {pmGuardando ? '⏳ Guardando…' : '💾 Guardar Métodos y Datos de Pago'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── 📄 Reporte: montado AL FINAL y solo mientras está abierto (en web gana el último Modal montado). */}
      {reporteOpen ? (
        <ReporteCuentasModal
          tipo={tipo}
          lista={lista}
          todas={ordenadas}
          universo={universo}
          marcadas={marcadas}
          tasaBcv={tasaBcv}
          hoy={hoy}
          onClose={() => setReporteOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

// Las dos pestañas, para que Compras las monte junto a las suyas. Se exponen
// desde acá para no repetir etiqueta ni icono en dos archivos.
export const CUENTAS_TABS: { key: CuentaTipo; label: string; icon: string }[] = [
  { key: 'por_pagar',  label: TIPO_CFG.por_pagar.label,  icon: TIPO_CFG.por_pagar.icon },
  { key: 'por_cobrar', label: TIPO_CFG.por_cobrar.label, icon: TIPO_CFG.por_cobrar.icon },
];
