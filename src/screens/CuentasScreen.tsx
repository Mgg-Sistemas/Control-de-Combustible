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
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { Cuenta, CuentaAbono, CuentaTipo, Supplier, Company, PurchaseOrder, InventoryRequirement } from '../types/database';
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
import { pickAndUploadDocFile } from '../lib/photo';
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
  limpiarNotaCuentasVisual,
  type ReciboPagoInfo,
} from '../lib/cuentasPago';
import { extraerReciboPago, inyectarReciboPagoEnObservaciones } from '../lib/requerimientoExpediente';
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

/** `contraparte` NO viene de la base: se resuelve contra el maestro
 *  (`suppliers` / `companies`) al momento de pintar. */
type CuentaCalc = Cuenta & {
  contraparte: string;
  abonado: number;
  saldo: number;
  situacion: Situacion;
  empresaId: string;
  empresaNombre: string;
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
  empresaInfo: InfoEmpresaCuenta
): CuentaCalc {
  const abonado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const monto = Number(c.monto) || 0;
  const saldo = Math.max(0, Math.round((monto - abonado) * 100) / 100);
  let situacion: Situacion;
  if (c.estado === 'anulada') situacion = 'anulada';
  else if (c.estado === 'pagada' || saldo <= 0) situacion = 'pagada';
  else if (c.fecha_vencimiento && c.fecha_vencimiento < hoy) situacion = 'vencida';
  else if (c.fecha_vencimiento && diasEntre(hoy, c.fecha_vencimiento) <= DIAS_POR_VENCER) situacion = 'por_vencer';
  else situacion = 'pendiente';
  return {
    ...c,
    contraparte,
    abonado,
    saldo,
    situacion,
    empresaId: empresaInfo.id,
    empresaNombre: empresaInfo.name,
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
  const { session } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const cfg = TIPO_CFG[tipo];
  const hoy = hoyISO();

  const { data: todas, loading, refetch } = useTable<Cuenta>('cuentas', { orderBy: 'fecha_vencimiento' });
  const { data: abonos, refetch: refetchAbonos } = useTable<CuentaAbono>('cuenta_abonos', { orderBy: 'fecha', ascending: false });
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: orders } = useTable<PurchaseOrder>('purchase_orders', { orderBy: 'created_at', ascending: false });
  const { data: requirements } = useTable<InventoryRequirement>('inventory_requirements');

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
  const [nota, setNota] = useState('');
  const [prioridad, setPrioridad] = useState<Prioridad | null>(null);   // grado de prioridad (opcional)
  const [orderId, setOrderId] = useState<string | null>(null);          // orden de compra atada (opcional)
  const [facturaUrl, setFacturaUrl] = useState<string | null>(null);    // archivo de la factura
  const [subiendoFactura, setSubiendoFactura] = useState(false);
  const [reciboPagoUrl, setReciboPagoUrl] = useState<string | null>(null); // soporte/recibo de pago
  const [subiendoReciboPago, setSubiendoReciboPago] = useState(false);
  const [empresaFormId, setEmpresaFormId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const abrirNueva = () => {
    setEdit(null); setContraparteId(null); setConcepto(''); setDocumento('');
    setMonto(''); setEmision(hoy); setVence(''); setNota('');
    setPrioridad(null); setOrderId(null); setFacturaUrl(null); setReciboPagoUrl(null);
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
    setNota(limpiarNotaCuentasVisual(c.nota));
    setPrioridad((c.prioridad as Prioridad) ?? null);
    setOrderId(c.order_id ?? null);
    setFacturaUrl(c.factura_url ?? null);
    const rp = extraerReciboPagoCuenta(c);
    setReciboPagoUrl(rp?.url ?? null);
    const empExtraida = (c as any).empresaId || extraerEmpresaDeNota(c.nota)?.id || c.company_id;
    setEmpresaFormId(empExtraida && empExtraida !== ID_SIN_EMPRESA ? empExtraida : null);
    setOpen(true);
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
    let notaFinal = inyectarReciboPagoEnNota(
      notaLimpia,
      reciboPagoUrl ? { url: reciboPagoUrl, tipo: 'image', nombre: 'Recibo de pago', subidoPor: session?.user?.email || 'Administración' } : null
    );
    if (empresaFormId) {
      const comp = companies.find((co) => co.id === empresaFormId);
      notaFinal = inyectarEmpresaEnNota(notaFinal, empresaFormId, comp?.name) || '';
    } else {
      notaFinal = inyectarEmpresaEnNota(notaFinal, null, null) || '';
    }

    const fila = {
      tipo,
      supplier_id: tipo === 'por_pagar' ? contraparteId : null,
      company_id: tipo === 'por_cobrar' ? contraparteId : null,
      order_id: orderId,
      concepto: concepto.trim(),
      documento: documento.trim() || null,
      factura_url: facturaUrl,
      prioridad,
      monto: importe,
      fecha_emision: emision,
      fecha_vencimiento: vence || null,
      nota: notaFinal,
    };

    setBusy(true);
    const { error } = edit
      ? await supabase.from('cuentas').update({ ...fila, updated_at: nowISO() }).eq('id', edit.id)
      : await supabase.from('cuentas').insert({ ...fila, estado: 'pendiente', created_by: session?.user?.id ?? null });
    setBusy(false);
    if (error) return toast.error(error.message);
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
    const { error } = await supabase.from('cuentas')
      .update({ estado: 'pagada', settled_by: session?.user?.id ?? null, settled_at: nowISO(), updated_at: nowISO() })
      .eq('id', c.id);
    if (error) return toast.error(error.message);

    // Sincronización automática con el requerimiento de compras si nació de uno
    if (c.order_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, observaciones')
          .eq('id', c.order_id)
          .limit(1);
        if (reqRows && reqRows[0]) {
          const recExist = extraerReciboPago(reqRows[0]);
          if (!recExist || (!recExist.url && !recExist.referencia)) {
            const notaRecibo = inyectarReciboPagoEnObservaciones(
              reqRows[0].observaciones,
              {
                url: c.factura_url || '',
                tipo: 'image',
                nombre: 'Comprobante de Pago Cuentas por Pagar',
                fecha: nowISO().slice(0, 10),
                referencia: c.documento || 'CXP-PAGADA',
                monto: Number(c.monto) || null,
                metodo: 'Cuentas por Pagar',
                subidoPor: session?.user?.email || 'Tesorería',
                subidoAt: nowISO(),
              }
            );
            await supabase
              .from('inventory_requirements')
              .update({ observaciones: notaRecibo })
              .eq('id', c.order_id);
          }
        }
      } catch (eSync) {
        console.warn('Sync cxp a req error:', eSync);
      }
    }

    refetch();
    toast.success('Cuenta marcada como pagada.');
  };

  const anular = async (c: CuentaCalc) => {
    const ok = await confirm({
      title: 'Anular cuenta',
      message: `¿Anular la cuenta de ${c.contraparte} (${c.concepto})? Deja de sumar en los totales, pero NO se borra: queda en el historial como anulada.`,
      confirmText: 'Anular',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('cuentas').update({ estado: 'anulada', updated_at: nowISO() }).eq('id', c.id);
    if (error) return toast.error(error.message);
    refetch();
    toast.success('Cuenta anulada.');
  };

  const reabrir = async (c: CuentaCalc) => {
    const tieneAbonos = c.abonado > 0;
    const ok = await confirm({
      title: 'Revertir pago / Volver a pendiente',
      message: `¿Devolver a PENDIENTE la cuenta de ${c.contraparte} (${c.concepto})?` +
        (tieneAbonos ? `\n\nSe eliminarán también los abonos registrados (${usd(c.abonado)}) para restaurar el saldo completo.` : '') +
        (c.order_id ? '\n\nTambién se revertirá el estado de pago en el Requerimiento de Compra asociado.' : ''),
      confirmText: 'Volver a pendiente',
    });
    if (!ok) return;
    if (tieneAbonos) {
      await supabase.from('cuenta_abonos').delete().eq('cuenta_id', c.id);
    }
    const notaSinRecibo = inyectarReciboPagoEnNota(limpiarNotaCuentasVisual(c.nota), null);
    const { error } = await supabase.from('cuentas')
      .update({ estado: 'pendiente', settled_by: null, settled_at: null, nota: notaSinRecibo, updated_at: nowISO() })
      .eq('id', c.id);
    if (error) return toast.error(error.message);

    // Sincronizar con el requerimiento si está ligado (quitar recibo de pago y devolver a aprobado si estaba en esperando_recepcion/pagado)
    if (c.order_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, status, observaciones')
          .eq('id', c.order_id)
          .limit(1);
        if (reqRows && reqRows[0]) {
          const rRow = reqRows[0] as any;
          const obsSinRecibo = inyectarReciboPagoEnObservaciones(rRow.observaciones, null);
          const nextStatus = rRow.status === 'esperando_recepcion' || rRow.status === 'pagado' ? 'aprobado' : rRow.status;
          await supabase
            .from('inventory_requirements')
            .update({ observaciones: obsSinRecibo, status: nextStatus })
            .eq('id', c.order_id);
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
          nota: c.nota,
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

    // Sincronización automática con requerimiento si el abono saldó la deuda
    if (importe >= abonoDe.saldo && abonoDe.order_id) {
      try {
        const { data: reqRows } = await supabase
          .from('inventory_requirements')
          .select('id, observaciones')
          .eq('id', abonoDe.order_id)
          .limit(1);
        if (reqRows && reqRows[0]) {
          const notaRecibo = inyectarReciboPagoEnObservaciones(
            reqRows[0].observaciones,
            {
              url: abComprobanteUrl || '',
              tipo: 'image',
              nombre: 'Comprobante de Pago Cuentas por Pagar',
              fecha: abFecha,
              referencia: abRef.trim() || 'Abono Total CXP',
              monto: importe,
              metodo: abMetodo.trim() || 'Abono Bancario',
              subidoPor: session?.user?.email || 'Tesorería',
              subidoAt: nowISO(),
            }
          );
          await supabase
            .from('inventory_requirements')
            .update({ observaciones: notaRecibo })
            .eq('id', abonoDe.order_id);
        }
      } catch (eSync) {
        console.warn('Sync cxp abono a req error:', eSync);
      }
    }

    setAbonoDe(null);
    refetchAbonos(); refetch();
    toast.success(importe >= abonoDe.saldo ? 'Abono registrado. La cuenta quedó saldada.' : 'Abono registrado.');
  };

  // ── Lista + totales con filtro por empresa (una o varias) ────────────────
  const { lista, tot, empresaCounts, ordenadas, universo } = useMemo(() => {
    const porCuenta = new Map<string, CuentaAbono[]>();
    abonos.forEach((a) => {
      const arr = porCuenta.get(a.cuenta_id) ?? [];
      arr.push(a);
      porCuenta.set(a.cuenta_id, arr);
    });

    const calc = todas
      .filter((c) => c.tipo === tipo)
      .map((c) => {
        const empInfo = resolverEmpresaDeCuenta(c, {
          companies,
          requirements,
          orders,
        });
        return calcular(c, porCuenta.get(c.id) ?? [], hoy, nombreDe(c), empInfo);
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

    // Los totales se calculan sobre las cuentas del filtro de empresa (la posición real de esa selección)
    const t = { pendiente: 0, vencido: 0, porVencer: 0, nVencidas: 0 };
    porEmpresas.forEach((c) => {
      if (c.situacion === 'anulada' || c.situacion === 'pagada') return;
      t.pendiente += c.saldo;
      if (c.situacion === 'vencida') { t.vencido += c.saldo; t.nVencidas += 1; }
      if (c.situacion === 'por_vencer') t.porVencer += c.saldo;
    });

    const nq = norm(q);
    const pasaVerPagadas = (c: CuentaCalc) => (verPagadas ? true : c.situacion !== 'pagada' && c.situacion !== 'anulada');
    const vis = porEmpresas
      .filter(pasaVerPagadas)
      .filter((c) => matchNorm(nq, c.contraparte, c.concepto, c.documento, c.nota, c.empresaNombre))
      // Orden: lo más urgente arriba (ver `ordenUrgencia`).
      .sort(ordenUrgencia);

    // 📄 Para el reporte: TODAS las de la pestaña (las marcadas salen de aquí,
    // aunque el filtro de ahora las esconda) y el «universo» = la lista sin
    // filtro de empresa ni búsqueda (contra él se decide si el papel es FILTRADO).
    const ord = calc.slice().sort(ordenUrgencia);
    const uni = ord.filter(pasaVerPagadas);

    return { lista: vis, tot: t, empresaCounts: arrEmpresas, ordenadas: ord, universo: uni };
  }, [todas, abonos, tipo, q, verPagadas, hoy, nombreDe, companies, requirements, orders, empresaSel]);

  // Contador de marcas: solo las que existen en esta pestaña; y cuántas no se ven ahora.
  const nMarcadas = useMemo(() => ordenadas.filter((c) => marcadas.has(c.id)).length, [ordenadas, marcadas]);
  const nMarcadasFuera = useMemo(() => {
    const visibles = new Set(lista.map((c) => c.id));
    return ordenadas.filter((c) => marcadas.has(c.id) && !visibles.has(c.id)).length;
  }, [ordenadas, lista, marcadas]);

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

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Cuentas {cfg.label.toLowerCase()}</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
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

      {/* Buscador */}
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Buscar por contraparte, concepto, factura o nota…"
        placeholderTextColor={colors.muted}
        style={[inputStyle, { marginBottom: spacing.xs }]}
      />
      <TouchableOpacity onPress={() => setVerPagadas((v) => !v)} style={{ alignSelf: 'flex-start', marginBottom: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: verPagadas ? colors.brand : colors.border, backgroundColor: verPagadas ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
        <Text style={{ color: verPagadas ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
          {verPagadas ? '✓ Mostrando pagadas y anuladas' : 'Mostrar también pagadas y anuladas'}
        </Text>
      </TouchableOpacity>

      {/* ☑ Marcas para el reporte: por id, sobreviven a filtrar y buscar. */}
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
                  <Pill label={st.label} {...toneSoft(colors, st.tone)} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <View style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '800' }}>
                      🏢 {c.empresaNombre}
                    </Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>
                    {c.concepto}{c.documento ? ` · ${c.documento}` : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
                  <Text style={{ color: vencida ? colors.dangerSoftText : colors.text, fontSize: 12, fontWeight: '700' }}>
                    Vence: {fmtFecha(c.fecha_vencimiento)}
                    {dias != null && abiertas ? (dias < 0 ? ` · hace ${Math.abs(dias)} día(s)` : dias === 0 ? ' · HOY' : ` · en ${dias} día(s)`) : ''}
                  </Text>
                  <Text style={{ color: colors.brandText, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(c.saldo)}</Text>
                </View>
              </View>
            }
            detail={
              <>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Monto original: {usd(Number(c.monto) || 0)} {c.moneda}</Text>
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
                {c.nota && limpiarNotaCuentasVisual(c.nota) ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Nota: {limpiarNotaCuentasVisual(c.nota)}</Text>
                ) : null}

                {/* Soportes adjuntos: Factura y Recibo de Pago */}
                {(() => {
                  const rp = extraerReciboPagoCuenta(c);
                  if (!c.factura_url && !rp?.url) return null;
                  return (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                      {c.factura_url ? (
                        <TouchableOpacity onPress={() => Linking.openURL(c.factura_url!)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>📎 Ver factura</Text>
                        </TouchableOpacity>
                      ) : null}
                      {rp?.url ? (
                        <TouchableOpacity onPress={() => Linking.openURL(rp.url!)} style={{ backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                          <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 12 }}>💳 Ver recibo de pago</Text>
                        </TouchableOpacity>
                      ) : null}
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
                          {canWrite ? (
                            <TouchableOpacity onPress={() => eliminarAbono(a, c)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11 }}>🗑️ Quitar</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                {/* Recibo (PDF) — disponible siempre (solo lectura), con o sin permiso de escritura. */}
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                  <TouchableOpacity onPress={() => generarRecibo(c)} style={{ flexGrow: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>🧾 {tipo === 'por_cobrar' ? 'Recibo de cobro' : 'Recibo de pago'}</Text>
                  </TouchableOpacity>
                </View>

                {canWrite ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                    {abiertas ? (
                      <>
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

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{cfg.contraparteLabel}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>{cfg.contraparteHint}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {maestro.map((m) => {
                  const on = contraparteId === m.id;
                  return (
                    <TouchableOpacity key={m.id} onPress={() => setContraparteId(m.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
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
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Monto (USD)</Text>
              <TextInput value={monto} onChangeText={setMonto} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.muted} style={inputStyle} />
              <Text style={{ color: colors.brandText, fontWeight: '800', textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] as any }}>{usd(parseNum(monto))}</Text>
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
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nota (opcional)</Text>
              <TextInput value={nota} onChangeText={setNota} autoCapitalize="sentences" placeholder="Observación…" placeholderTextColor={colors.muted} style={inputStyle} />
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
              {orders.length === 0 ? (
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
                  <Text style={{ color: colors.brandText, fontWeight: '800', marginTop: spacing.xs, fontVariant: ['tabular-nums'] as any }}>Saldo actual: {usd(abonoDe.saldo)}</Text>
                </Card>
                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Monto del abono (USD)</Text>
                  <TextInput value={abMonto} onChangeText={setAbMonto} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.muted} style={inputStyle} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Fecha (AAAA-MM-DD)</Text>
                  <TextInput value={abFecha} onChangeText={setAbFecha} placeholder={hoy} placeholderTextColor={colors.muted} style={inputStyle} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Método (opcional)</Text>
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
