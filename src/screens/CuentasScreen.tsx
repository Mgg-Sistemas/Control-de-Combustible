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
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { Cuenta, CuentaAbono, CuentaTipo, Supplier, Company } from '../types/database';
import { generalCompanies } from '../lib/companies';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { matchNorm, norm, cmpText } from '../lib/text';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function parseNum(t: string): number { const n = Number(String(t ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
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
type CuentaCalc = Cuenta & { contraparte: string; abonado: number; saldo: number; situacion: Situacion };

/** Calcula saldo y situación de una cuenta a partir de sus abonos.
 *  Regla: una cuenta 'pendiente' cuyo saldo llegó a 0 con abonos ya se
 *  considera PAGADA aunque nadie haya tocado el botón — si no, seguiría
 *  sumando a "lo que debo" habiendo cobrado todo. */
function calcular(c: Cuenta, abonos: CuentaAbono[], hoy: string, contraparte: string): CuentaCalc {
  const abonado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const monto = Number(c.monto) || 0;
  const saldo = Math.max(0, Math.round((monto - abonado) * 100) / 100);
  let situacion: Situacion;
  if (c.estado === 'anulada') situacion = 'anulada';
  else if (c.estado === 'pagada' || saldo <= 0) situacion = 'pagada';
  else if (c.fecha_vencimiento && c.fecha_vencimiento < hoy) situacion = 'vencida';
  else if (c.fecha_vencimiento && diasEntre(hoy, c.fecha_vencimiento) <= DIAS_POR_VENCER) situacion = 'por_vencer';
  else situacion = 'pendiente';
  return { ...c, contraparte, abonado, saldo, situacion };
}

// ── Pestaña (el mismo componente para los dos tipos) ─────────────────────────
export function CuentasTab({ tipo, canWrite }: { tipo: CuentaTipo; canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const cfg = TIPO_CFG[tipo];
  const hoy = hoyISO();

  const { data: todas, loading, refetch } = useTable<Cuenta>('cuentas', { orderBy: 'fecha_vencimiento' });
  const { data: abonos, refetch: refetchAbonos } = useTable<CuentaAbono>('cuenta_abonos', { orderBy: 'fecha', ascending: false });
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });

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
    return (c: Cuenta) => m.get((c.tipo === 'por_pagar' ? c.supplier_id : c.company_id) ?? '') ?? '—';
  }, [maestro]);

  const [q, setQ] = useState('');
  const [verPagadas, setVerPagadas] = useState(false);

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
  const [busy, setBusy] = useState(false);

  // ── Abono (pago parcial) ──────────────────────────────────────────────────
  const [abonoDe, setAbonoDe] = useState<CuentaCalc | null>(null);
  const [abMonto, setAbMonto] = useState('');
  const [abFecha, setAbFecha] = useState(hoy);
  const [abMetodo, setAbMetodo] = useState('');
  const [abRef, setAbRef] = useState('');

  const abrirNueva = () => {
    setEdit(null); setContraparteId(null); setConcepto(''); setDocumento('');
    setMonto(''); setEmision(hoy); setVence(''); setNota(''); setOpen(true);
  };
  const abrirEdicion = (c: Cuenta) => {
    setEdit(c);
    setContraparteId((c.tipo === 'por_pagar' ? c.supplier_id : c.company_id) ?? null);
    setConcepto(c.concepto);
    setDocumento(c.documento ?? '');
    setMonto(String(Number(c.monto) || 0));
    setEmision(c.fecha_emision);
    setVence(c.fecha_vencimiento ?? '');
    setNota(c.nota ?? '');
    setOpen(true);
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

    const fila = {
      tipo,
      supplier_id: tipo === 'por_pagar' ? contraparteId : null,
      company_id: tipo === 'por_cobrar' ? contraparteId : null,
      concepto: concepto.trim().toUpperCase(),
      documento: documento.trim().toUpperCase() || null,
      monto: importe,
      fecha_emision: emision,
      fecha_vencimiento: vence || null,
      nota: nota.trim().toUpperCase() || null,
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
    const ok = await confirm({
      title: 'Volver a pendiente',
      message: `¿Devolver a PENDIENTE la cuenta de ${c.contraparte} (${c.concepto})? Volverá a sumar en los totales.`,
      confirmText: 'Volver a pendiente',
    });
    if (!ok) return;
    const { error } = await supabase.from('cuentas')
      .update({ estado: 'pendiente', settled_by: null, settled_at: null, updated_at: nowISO() })
      .eq('id', c.id);
    if (error) return toast.error(error.message);
    refetch();
    toast.success('La cuenta volvió a pendiente.');
  };

  const abrirAbono = (c: CuentaCalc) => { setAbonoDe(c); setAbMonto(String(c.saldo || '')); setAbFecha(hoy); setAbMetodo(''); setAbRef(''); };

  const guardarAbono = async () => {
    if (!abonoDe) return;
    const importe = parseNum(abMonto);
    if (!(importe > 0)) return toast.error('El abono debe ser mayor que cero.');
    if (importe > abonoDe.saldo) return toast.error(`El abono no puede pasar del saldo (${usd(abonoDe.saldo)}).`);
    if (!fechaValida(abFecha)) return toast.error('La fecha del abono debe ser AAAA-MM-DD.');
    setBusy(true);
    const { error } = await supabase.from('cuenta_abonos').insert({
      cuenta_id: abonoDe.id, monto: importe, fecha: abFecha,
      metodo: abMetodo.trim().toUpperCase() || null, referencia: abRef.trim().toUpperCase() || null,
      created_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setAbonoDe(null);
    refetchAbonos(); refetch();
    toast.success(importe >= abonoDe.saldo ? 'Abono registrado. La cuenta quedó saldada.' : 'Abono registrado.');
  };

  // ── Lista + totales ───────────────────────────────────────────────────────
  const { lista, tot } = useMemo(() => {
    const porCuenta = new Map<string, CuentaAbono[]>();
    abonos.forEach((a) => {
      const arr = porCuenta.get(a.cuenta_id) ?? [];
      arr.push(a);
      porCuenta.set(a.cuenta_id, arr);
    });

    const calc = todas
      .filter((c) => c.tipo === tipo)
      .map((c) => calcular(c, porCuenta.get(c.id) ?? [], hoy, nombreDe(c)));

    // Los totales se calculan sobre TODAS las cuentas del tipo (no sobre lo
    // filtrado por el buscador): son la posición real, no la de la búsqueda.
    // Las anuladas y las pagadas no suman.
    const t = { pendiente: 0, vencido: 0, porVencer: 0, nVencidas: 0 };
    calc.forEach((c) => {
      if (c.situacion === 'anulada' || c.situacion === 'pagada') return;
      t.pendiente += c.saldo;
      if (c.situacion === 'vencida') { t.vencido += c.saldo; t.nVencidas += 1; }
      if (c.situacion === 'por_vencer') t.porVencer += c.saldo;
    });

    const nq = norm(q);
    const vis = calc
      .filter((c) => (verPagadas ? true : c.situacion !== 'pagada' && c.situacion !== 'anulada'))
      .filter((c) => matchNorm(nq, c.contraparte, c.concepto, c.documento, c.nota))
      // Orden: lo más urgente arriba (vencida → por vencer → pendiente →
      // pagada/anulada) y, dentro de cada grupo, por vencimiento más cercano.
      .sort((a, b) => {
        const rank: Record<Situacion, number> = { vencida: 0, por_vencer: 1, pendiente: 2, pagada: 3, anulada: 4 };
        if (rank[a.situacion] !== rank[b.situacion]) return rank[a.situacion] - rank[b.situacion];
        const av = a.fecha_vencimiento ?? '9999-12-31';
        const bv = b.fecha_vencimiento ?? '9999-12-31';
        if (av !== bv) return av < bv ? -1 : 1;
        return cmpText(a.contraparte, b.contraparte);
      });

    return { lista: vis, tot: t };
  }, [todas, abonos, tipo, q, verPagadas, hoy, nombreDe]);

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
        {canWrite ? (
          <TouchableOpacity onPress={abrirNueva} style={{ backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>+ Nueva</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Totales — la posición real del tipo, no la de la búsqueda. */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Quick label="TOTAL PENDIENTE" value={tot.pendiente} color={colors.brandText} />
        <Quick label="VENCIDO" value={tot.vencido} color={colors.dangerSoftText} sub={tot.nVencidas ? `${tot.nVencidas} cuenta(s)` : undefined} />
        <Quick label={`POR VENCER (${DIAS_POR_VENCER} DÍAS)`} value={tot.porVencer} color={colors.warningSoftText} />
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
                  <Text style={{ fontWeight: '800', fontSize: 15, color: colors.brandText, flex: 1 }} numberOfLines={1}>{c.contraparte}</Text>
                  <Pill label={st.label} {...toneSoft(colors, st.tone)} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {c.concepto}{c.documento ? ` · ${c.documento}` : ''}
                </Text>
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
                <Text style={{ color: colors.muted, fontSize: 13 }}>Abonado: {usd(c.abonado)}</Text>
                <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] as any }}>Saldo: {usd(c.saldo)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Emitida: {fmtFecha(c.fecha_emision)}</Text>
                {c.nota ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Nota: {c.nota}</Text> : null}

                {/* Historial de abonos de esta cuenta */}
                {abonos.filter((a) => a.cuenta_id === c.id).length > 0 ? (
                  <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Abonos</Text>
                    {abonos.filter((a) => a.cuenta_id === c.id).map((a) => (
                      <Text key={a.id} style={{ color: colors.muted, fontSize: 12 }}>
                        • {fmtFecha(a.fecha)} · {usd(Number(a.monto) || 0)}{a.metodo ? ` · ${a.metodo}` : ''}{a.referencia ? ` · ${a.referencia}` : ''}
                      </Text>
                    ))}
                  </View>
                ) : null}

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

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Concepto (por qué se debe)</Text>
              <TextInput value={concepto} onChangeText={(t) => setConcepto(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. REPUESTOS FACTURA 0123" placeholderTextColor={colors.muted} style={inputStyle} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Nº de factura / control (opcional)</Text>
              <TextInput value={documento} onChangeText={(t) => setDocumento(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. F-00123" placeholderTextColor={colors.muted} style={inputStyle} />
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
              <TextInput value={nota} onChangeText={(t) => setNota(t.toUpperCase())} autoCapitalize="characters" placeholder="OBSERVACIÓN…" placeholderTextColor={colors.muted} style={inputStyle} />
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
                  <TextInput value={abMetodo} onChangeText={(t) => setAbMetodo(t.toUpperCase())} autoCapitalize="characters" placeholder="EFECTIVO / TRANSFERENCIA / CHEQUE" placeholderTextColor={colors.muted} style={inputStyle} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Referencia (opcional)</Text>
                  <TextInput value={abRef} onChangeText={(t) => setAbRef(t.toUpperCase())} autoCapitalize="characters" placeholder="Nº DE TRANSFERENCIA / CHEQUE" placeholderTextColor={colors.muted} style={inputStyle} />
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
    </Screen>
  );
}

// Las dos pestañas, para que Compras las monte junto a las suyas. Se exponen
// desde acá para no repetir etiqueta ni icono en dos archivos.
export const CUENTAS_TABS: { key: CuentaTipo; label: string; icon: string }[] = [
  { key: 'por_pagar',  label: TIPO_CFG.por_pagar.label,  icon: TIPO_CFG.por_pagar.icon },
  { key: 'por_cobrar', label: TIPO_CFG.por_cobrar.label, icon: TIPO_CFG.por_cobrar.icon },
];
